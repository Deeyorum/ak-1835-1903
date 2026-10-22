import * as path from "path";
import { loadWorldFromFile } from "./loadWorldFile";
import { setupMatch, DEFAULT_TURN_LIMIT } from "../src/game/setup";
import { processTurn } from "../src/game/engine";
import { kacakView, avciView } from "../src/game/views";
import type { HakemKanali } from "../src/game/hakemKanali";
import { createRng } from "../src/game/rng";
import { distance, type WorldData } from "../src/game/world";
import type {
  AvciMove,
  MatchState,
  PageTitle,
  Role,
  Specialization,
  WorldPage,
} from "../src/game/types";
import {
  computeDereceEsikleri,
  harfSlice,
  dereceSlice,
  bolgeSlice,
  kategoriSlice as kategoriSliceOld,
  type SliceType,
  type DereceEsikleri,
} from "./slices";
import { computeCategoryDistribution, kategoriSliceV2, DIGER } from "./slices_v2";
import { stayKacak, wanderingKacak, type KacakBotFn } from "./bots/kacakBots";

const WORLD_FILE = path.join(__dirname, "../world/world.scc.json");
const N_SEEDS = 300;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
function p90(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
}

type KategoriKural = "eski" | "M20" | "M50";

function kategoriValueFn(
  rule: KategoriKural,
  memberCounts: Map<string, number>
): (page: WorldPage) => string | null {
  if (rule === "eski") return (p) => kategoriSliceOld(p);
  const M = rule === "M20" ? 20 : 50;
  return (p) => kategoriSliceV2(p, memberCounts, M);
}

// ---------- FAZ 1: Kategori dağılımı ----------

function runPhase1(pages: WorldPage[]) {
  console.log(`\n=== FAZ 1: Kategori Dağılımı (SCC, ${pages.length} sayfa) ===\n`);
  const dist = computeCategoryDistribution(pages);
  console.log(`Benzersiz kategori sayısı: ${dist.memberCounts.size}`);
  console.log(`Histogram (üye sayısı kovaları):`);
  for (const h of dist.histogram) {
    console.log(`  ${h.bucket.padEnd(6)}: ${h.count}`);
  }
  console.log(
    `Doğum/ölüm yılı kategorileri: ${dist.birthDeathCategoryCount}/${dist.memberCounts.size} benzersiz kategori (%${(dist.birthDeathCategoryShare * 100).toFixed(1)}), (sayfa,kategori) çiftlerinin %${(dist.birthDeathMemberShare * 100).toFixed(1)}'i`
  );
  return dist;
}

// ---------- FAZ 2 + 3: Yeni kural + statik aday kümesi ----------

function intersectSize(sets: Set<PageTitle>[]): number {
  if (sets.length === 0) return 0;
  const sorted = [...sets].sort((a, b) => a.size - b.size);
  const [smallest, ...rest] = sorted;
  let count = 0;
  for (const item of smallest) {
    if (rest.every((s) => s.has(item))) count++;
  }
  return count;
}

function buildBuckets<K>(pages: WorldPage[], valueFn: (p: WorldPage) => K): Map<K, Set<PageTitle>> {
  const buckets = new Map<K, Set<PageTitle>>();
  for (const p of pages) {
    const v = valueFn(p);
    if (!buckets.has(v)) buckets.set(v, new Set());
    buckets.get(v)!.add(p.title);
  }
  return buckets;
}

function runPhase2And3(
  world: WorldData,
  pages: WorldPage[],
  esikler: DereceEsikleri,
  memberCounts: Map<string, number>
) {
  console.log(`\n=== FAZ 2: Yeni Kategori Kuralı (diğer sayımı) ===\n`);
  const rules: KategoriKural[] = ["eski", "M20", "M50"];
  const valueFns = new Map(rules.map((r) => [r, kategoriValueFn(r, memberCounts)] as const));

  for (const rule of rules) {
    if (rule === "eski") continue;
    const fn = valueFns.get(rule)!;
    const digerCount = pages.filter((p) => fn(p) === DIGER).length;
    console.log(`  ${rule}: "diğer" alan sayfa sayısı = ${digerCount}/${pages.length}`);
  }

  console.log(`\n=== FAZ 3: Statik Aday Kümesi (3 kural karşılaştırması) ===\n`);
  const harfBuckets = buildBuckets(pages, (p) => harfSlice(p.title));
  const dereceBuckets = buildBuckets(pages, (p) => dereceSlice(world, p.title, esikler));
  const harfValue = new Map(pages.map((p) => [p.title, harfSlice(p.title)] as const));
  const dereceValue = new Map(
    pages.map((p) => [p.title, dereceSlice(world, p.title, esikler)] as const)
  );

  for (const rule of rules) {
    const fn = valueFns.get(rule)!;
    const kategoriBuckets = buildBuckets(pages, (p) => fn(p));
    const kategoriValue = new Map(pages.map((p) => [p.title, fn(p)] as const));

    const aloneCounts = pages.map(
      (p) => kategoriBuckets.get(kategoriValue.get(p.title)!)?.size ?? 0
    );
    const comboCounts = pages.map((p) => {
      const sets = [
        kategoriBuckets.get(kategoriValue.get(p.title)!) ?? new Set<PageTitle>(),
        harfBuckets.get(harfValue.get(p.title)!) ?? new Set<PageTitle>(),
        dereceBuckets.get(dereceValue.get(p.title)!) ?? new Set<PageTitle>(),
      ];
      return intersectSize(sets);
    });

    console.log(
      `  [${rule}] kategori tek başına: medyan=${median(aloneCounts).toFixed(1)} p90=${p90(aloneCounts).toFixed(1)} | kategori+harf+derece: medyan=${median(comboCounts).toFixed(1)}`
    );
  }

  // Diğer dilimlerin (kurala bağımsız) tek-başına medyanı — öncelik sırası için.
  const rng = createRng(999);
  const avciSamples = Array.from({ length: 200 }, () => rng.pick(world.titles));
  const bolgeAloneCounts: number[] = [];
  for (const avciPos of avciSamples) {
    const bolgeBuckets = new Map<string, number>();
    for (const kacakPos of world.titles) {
      const band = bolgeSlice(world, avciPos, kacakPos)!;
      bolgeBuckets.set(band, (bolgeBuckets.get(band) ?? 0) + 1);
    }
    for (const kacakPos of world.titles) {
      const band = bolgeSlice(world, avciPos, kacakPos)!;
      bolgeAloneCounts.push(bolgeBuckets.get(band)!);
    }
  }
  const harfAloneCounts = pages.map((p) => harfBuckets.get(harfValue.get(p.title)!)?.size ?? 0);
  const dereceAloneCounts = pages.map(
    (p) => dereceBuckets.get(dereceValue.get(p.title)!)?.size ?? 0
  );
  const hareketAloneMedian = pages.length; // daraltma gücü yok

  console.log(`\n  (kural-bağımsız) harf tek başına medyan=${median(harfAloneCounts).toFixed(1)}`);
  console.log(`  (kural-bağımsız) derece tek başına medyan=${median(dereceAloneCounts).toFixed(1)}`);
  console.log(`  (kural-bağımsız) bölge tek başına medyan=${median(bolgeAloneCounts).toFixed(1)}`);
  console.log(`  (kural-bağımsız) hareket tek başına medyan=${hareketAloneMedian} (daraltmaz)`);

  const priorityOrders = new Map<KategoriKural, SliceType[]>();
  for (const rule of rules) {
    const fn = valueFns.get(rule)!;
    const kategoriBuckets = buildBuckets(pages, (p) => fn(p));
    const kategoriValue = new Map(pages.map((p) => [p.title, fn(p)] as const));
    const kategoriAloneMedian = median(
      pages.map((p) => kategoriBuckets.get(kategoriValue.get(p.title)!)?.size ?? 0)
    );
    const singleMedians: { type: SliceType; med: number }[] = [
      { type: "kategori", med: kategoriAloneMedian },
      { type: "harf", med: median(harfAloneCounts) },
      { type: "derece", med: median(dereceAloneCounts) },
      { type: "bolge", med: median(bolgeAloneCounts) },
      { type: "hareket", med: hareketAloneMedian },
    ];
    singleMedians.sort((a, b) => a.med - b.med);
    priorityOrders.set(rule, singleMedians.map((s) => s.type));
    console.log(`  [${rule}] öncelik sırası: ${singleMedians.map((s) => s.type).join(" > ")}`);
  }

  return priorityOrders;
}

// ---------- FAZ 4: Filtre-Avcı yeniden ölçüm ----------

type MemoryMode = "birlesik" | "sonTur";

function createSliceHakemStubV2(
  world: WorldData,
  getState: () => MatchState,
  esikler: DereceEsikleri,
  kategoriFn: (page: WorldPage) => string | null
): HakemKanali {
  return {
    mesajGonder(gonderen: Role, mesaj: string): string {
      if (gonderen !== "avci") return "Bu konuda bilgi veremem.";
      const state = getState();
      const sliceType = mesaj as SliceType;
      switch (sliceType) {
        case "kategori": {
          const page = world.pages.get(state.kacakPosition);
          const v = page ? kategoriFn(page) : null;
          return v ?? "bilinmiyor";
        }
        case "bolge": {
          const v = bolgeSlice(world, state.avciPosition, state.kacakPosition);
          return v ?? "bilinmiyor";
        }
        case "hareket":
          return String(state.kacakStayStreak);
        case "harf":
          return harfSlice(state.kacakPosition);
        case "derece":
          return dereceSlice(world, state.kacakPosition, esikler);
        default:
          return "bilinmiyor";
      }
    },
  };
}

function filterPagesBySlice(
  world: WorldData,
  pages: WorldPage[],
  sliceType: SliceType,
  value: unknown,
  ctx: { avciPos: PageTitle; esikler: DereceEsikleri; kategoriFn: (p: WorldPage) => string | null }
): WorldPage[] {
  switch (sliceType) {
    case "kategori":
      return pages.filter((p) => ctx.kategoriFn(p) === value);
    case "harf":
      return pages.filter((p) => harfSlice(p.title) === value);
    case "derece":
      return pages.filter((p) => dereceSlice(world, p.title, ctx.esikler) === value);
    case "bolge":
      return pages.filter((p) => bolgeSlice(world, ctx.avciPos, p.title) === value);
    case "hareket":
      return pages; // daraltma gücü yok (bkz. G2C notu)
    default:
      return pages;
  }
}

interface HunterV2 {
  sliceTypesToAskThisTurn(): SliceType[];
  recordAnswers(asked: SliceType[], cevaplar: string[]): void;
  decide(view: ReturnType<typeof avciView>): AvciMove;
}

function createHunterV2(
  world: WorldData,
  allPages: WorldPage[],
  priorityOrder: SliceType[],
  N: number,
  K: number,
  memoryMode: MemoryMode,
  esikler: DereceEsikleri,
  kategoriFn: (p: WorldPage) => string | null
): HunterV2 {
  const activeSlices = priorityOrder.slice(0, N);
  let known = new Map<SliceType, unknown>();
  let rrPointer = 0;

  return {
    sliceTypesToAskThisTurn(): SliceType[] {
      if (activeSlices.length === 0) return [];
      const toAsk: SliceType[] = [];
      for (let i = 0; i < K && i < activeSlices.length; i++) {
        toAsk.push(activeSlices[(rrPointer + i) % activeSlices.length]);
      }
      rrPointer = (rrPointer + Math.min(K, activeSlices.length)) % activeSlices.length;
      return toAsk;
    },
    recordAnswers(asked: SliceType[], cevaplar: string[]) {
      if (memoryMode === "sonTur") known = new Map();
      for (let i = 0; i < asked.length && i < cevaplar.length; i++) {
        const sliceType = asked[i];
        const raw = cevaplar[i];
        const value: unknown = sliceType === "hareket" ? Number(raw) : raw;
        known.set(sliceType, value);
      }
    },
    decide(view): AvciMove {
      let candidates = allPages;
      for (const sliceType of activeSlices) {
        if (!known.has(sliceType)) continue;
        candidates = filterPagesBySlice(world, candidates, sliceType, known.get(sliceType), {
          avciPos: view.kendiKonum,
          esikler,
          kategoriFn,
        });
      }

      if (candidates.some((p) => p.title === view.kendiKonum)) {
        return { type: "yakala" };
      }

      let target: PageTitle | null = null;
      let bestDist = Infinity;
      for (const c of candidates) {
        const d = distance(world, view.kendiKonum, c.title) ?? Infinity;
        if (d < bestDist) {
          bestDist = d;
          target = c.title;
        }
      }
      if (target === null || view.komsular.length === 0) return { type: "yakala" };

      let bestNeighbor: PageTitle | null = null;
      let bestNeighborDist = Infinity;
      for (const n of view.komsular) {
        const d = distance(world, n, target) ?? Infinity;
        if (d < bestNeighborDist) {
          bestNeighborDist = d;
          bestNeighbor = n;
        }
      }
      if (bestNeighbor === null) return { type: "yakala" };
      return { type: "git", to: bestNeighbor };
    },
  };
}

interface MatchMetrics {
  status: MatchState["status"];
  turnsPlayed: number;
}

function runMatchV2(
  world: WorldData,
  pages: WorldPage[],
  seed: number,
  kacakBot: KacakBotFn,
  N: number,
  K: number,
  rule: KategoriKural,
  memoryMode: MemoryMode,
  priorityOrder: SliceType[],
  esikler: DereceEsikleri,
  kategoriFn: (p: WorldPage) => string | null
): MatchMetrics {
  const avciSpecializations: Specialization[] = K === 2 ? ["arabulucu"] : [];
  let state = setupMatch(world, {
    seed,
    kacakSpecializations: [],
    avciSpecializations,
    turnLimit: DEFAULT_TURN_LIMIT,
  });
  const botRng = createRng(seed);
  const hakem = createSliceHakemStubV2(world, () => state, esikler, kategoriFn);
  const hunter = createHunterV2(world, pages, priorityOrder, N, K, memoryMode, esikler, kategoriFn);

  const SAFETY_CAP = state.turnLimit + 10;
  let iterations = 0;

  while (state.status === "devam" && iterations < SAFETY_CAP) {
    const kView = kacakView(world, state);
    const kMove = kacakBot(kView, botRng);

    // decide() ÖNCEKİ turlarda öğrenilenleri kullanır — bu turun sorusunun
    // yanıtı, motor sırası gereği ancak processTurn döndükten SONRA bilinir
    // (gerçekçi sıralama: cevap bir SONRAKİ tur kararına yansır).
    const sliceTypesAsked = hunter.sliceTypesToAskThisTurn();
    const aView = avciView(world, state);
    const aMove = hunter.decide(aView);

    // Hakem Q&A ÜRETIM KOTASI ÜZERİNDEN (K=1 -> taban 1, K=2 -> Arabulucu +1) --
    // G2C'deki K=3'ün aksine bu kez motorun gerçek kota mekanizması kullanılıyor.
    const result = processTurn(world, state, kMove, aMove, hakem, {
      avciHakemMesajlari: sliceTypesAsked,
    });

    const cevaplar = result.logEntry.hakemMesajlari
      .filter((m) => m.gonderen === "avci")
      .map((m) => m.yanit);
    hunter.recordAnswers(sliceTypesAsked, cevaplar);

    state = result.state;
    iterations++;
  }

  return { status: state.status, turnsPlayed: state.turn - 1 };
}

function runPhase4(
  world: WorldData,
  pages: WorldPage[],
  esikler: DereceEsikleri,
  memberCounts: Map<string, number>,
  priorityOrders: Map<KategoriKural, SliceType[]>
) {
  console.log(`\n=== FAZ 4: Filtre-Avcı Yeniden Ölçüm (${N_SEEDS} tohum/hücre) ===\n`);

  const rules: KategoriKural[] = ["eski", "M20", "M50"];
  const Ns = [1, 2, 3, 5];
  const Ks = [1, 2];
  const memoryModes: MemoryMode[] = ["birlesik", "sonTur"];
  const kacakBots: { name: string; fn: KacakBotFn }[] = [
    { name: "kal", fn: stayKacak },
    { name: "rastgeleGezen", fn: wanderingKacak },
  ];

  const rows: {
    rule: KategoriKural;
    N: number;
    K: number;
    memoryMode: MemoryMode;
    kacak: string;
    winRate: number;
    avgTurns: number;
  }[] = [];

  for (const rule of rules) {
    const kategoriFn = kategoriValueFn(rule, memberCounts);
    const priorityOrder = priorityOrders.get(rule)!;
    for (const N of Ns) {
      for (const K of Ks) {
        for (const memoryMode of memoryModes) {
          for (const kacak of kacakBots) {
            let wins = 0;
            let totalTurns = 0;
            for (let seed = 0; seed < N_SEEDS; seed++) {
              const m = runMatchV2(
                world,
                pages,
                seed,
                kacak.fn,
                N,
                K,
                rule,
                memoryMode,
                priorityOrder,
                esikler,
                kategoriFn
              );
              if (m.status === "avciKazandi") wins++;
              totalTurns += m.turnsPlayed;
            }
            rows.push({
              rule,
              N,
              K,
              memoryMode,
              kacak: kacak.name,
              winRate: wins / N_SEEDS,
              avgTurns: totalTurns / N_SEEDS,
            });
          }
        }
      }
    }
  }

  console.log(`Kural  N  K  Bellek    Kaçak            Kazanma%   OrtTur`);
  for (const r of rows) {
    console.log(
      `${r.rule.padEnd(7)}${String(r.N).padEnd(3)}${String(r.K).padEnd(3)}${r.memoryMode.padEnd(10)}${r.kacak.padEnd(17)}%${(r.winRate * 100).toFixed(1).padStart(6)}   ${r.avgTurns.toFixed(1)}`
    );
  }

  console.log(`\n=== Bayat bilgi etkisi: birleşik(a) - sonTur(b) farkı ===`);
  for (const rule of rules) {
    for (const N of Ns) {
      for (const K of Ks) {
        for (const kacak of kacakBots) {
          const a = rows.find(
            (r) => r.rule === rule && r.N === N && r.K === K && r.memoryMode === "birlesik" && r.kacak === kacak.name
          )!;
          const b = rows.find(
            (r) => r.rule === rule && r.N === N && r.K === K && r.memoryMode === "sonTur" && r.kacak === kacak.name
          )!;
          const diff = (a.winRate - b.winRate) * 100;
          console.log(
            `${rule} N=${N} K=${K} ${kacak.name}: birleşik=%${(a.winRate * 100).toFixed(1)} sonTur=%${(b.winRate * 100).toFixed(1)} fark=${diff >= 0 ? "+" : ""}${diff.toFixed(1)}`
          );
        }
      }
    }
  }

  console.log(`\n=== %20-60 hedef aralığı yorumu (zorlanmadı) ===`);
  for (const r of rows) {
    const inRange = r.winRate >= 0.2 && r.winRate <= 0.6;
    if (!inRange) {
      console.log(
        `${r.rule} N=${r.N} K=${r.K} ${r.memoryMode} ${r.kacak}: %${(r.winRate * 100).toFixed(1)} — aralık dışı`
      );
    }
  }

  return rows;
}

function main() {
  console.log(`Dünya yükleniyor: ${WORLD_FILE}`);
  const world = loadWorldFromFile(WORLD_FILE);
  const pages = world.titles.map((t) => world.pages.get(t)!);
  console.log(`${pages.length} sayfa (SCC) yüklendi.`);

  const esikler = computeDereceEsikleri(world);
  const dist = runPhase1(pages);
  const priorityOrders = runPhase2And3(world, pages, esikler, dist.memberCounts);
  runPhase4(world, pages, esikler, dist.memberCounts, priorityOrders);
}

main();
