import * as path from "path";
import { loadWorldFromFile } from "./loadWorldFile";
import { setupMatch, DEFAULT_TURN_LIMIT } from "../src/game/setup";
import { processTurn } from "../src/game/engine";
import { kacakView, avciView } from "../src/game/views";
import { createStubHakemKanali } from "../src/game/hakemKanali";
import { createRng } from "../src/game/rng";
import { distance, type WorldData } from "../src/game/world";
import type { AvciMove, MatchState, PageTitle, WorldPage } from "../src/game/types";
import {
  ALL_SLICE_TYPES,
  computeDereceEsikleri,
  kategoriSlice,
  harfSlice,
  dereceSlice,
  bolgeSlice,
  type SliceType,
  type DereceEsikleri,
  type Band,
} from "./slices";
import { createSliceHakemStub } from "./testHakem";
import { stayKacak, wanderingKacak, type KacakBotFn } from "./bots/kacakBots";
import { createFilterHunterAvci } from "./bots/filterHunter";

const WORLD_FILE = path.join(__dirname, "../world/world.scc.json");
const N_SEEDS = 300;
const N_RANDOM_AVCI_POSITIONS = 200;

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

function combinations<T>(arr: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (size > arr.length) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, size - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, size);
  return [...withFirst, ...withoutFirst];
}

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

function runPhase2(world: WorldData, pages: WorldPage[], esikler: DereceEsikleri) {
  console.log(`\n=== FAZ 2: Statik Aday Kümesi Analizi ===`);
  console.log(`Derece eşikleri (tertile): düşük ≤${esikler.dusukUst}, orta ≤${esikler.ortaUst}, yüksek >${esikler.ortaUst}\n`);

  const fullSet = new Set(pages.map((p) => p.title));
  const kategoriValue = new Map(pages.map((p) => [p.title, kategoriSlice(p)] as const));
  const harfValue = new Map(pages.map((p) => [p.title, harfSlice(p.title)] as const));
  const dereceValue = new Map(
    pages.map((p) => [p.title, dereceSlice(world, p.title, esikler)] as const)
  );
  const kategoriBuckets = buildBuckets(pages, (p) => kategoriSlice(p));
  const harfBuckets = buildBuckets(pages, (p) => harfSlice(p.title));
  const dereceBuckets = buildBuckets(pages, (p) => dereceSlice(world, p.title, esikler));

  const rng = createRng(999);
  const avciSamples: PageTitle[] = Array.from({ length: N_RANDOM_AVCI_POSITIONS }, () =>
    rng.pick(world.titles)
  );

  function bolgeBucketsFor(avciPos: PageTitle): Map<Band, Set<PageTitle>> {
    const b = new Map<Band, Set<PageTitle>>();
    for (const p of pages) {
      const band = bolgeSlice(world, avciPos, p.title);
      if (band === null) continue;
      if (!b.has(band)) b.set(band, new Set());
      b.get(band)!.add(p.title);
    }
    return b;
  }

  const allCombos = [1, 2, 3, 4, 5].flatMap((size) => combinations(ALL_SLICE_TYPES, size));
  const results: { combo: SliceType[]; mean: number; median: number; p90: number }[] = [];

  for (const combo of allCombos) {
    const includesBolge = combo.includes("bolge");
    const counts: number[] = [];

    if (!includesBolge) {
      for (const kacakPos of world.titles) {
        const sets: Set<PageTitle>[] = combo.map((t) => {
          if (t === "hareket") return fullSet;
          if (t === "kategori") return kategoriBuckets.get(kategoriValue.get(kacakPos)!) ?? new Set();
          if (t === "harf") return harfBuckets.get(harfValue.get(kacakPos)!) ?? new Set();
          return dereceBuckets.get(dereceValue.get(kacakPos)!) ?? new Set();
        });
        counts.push(intersectSize(sets));
      }
    } else {
      for (const avciPos of avciSamples) {
        const bolgeBuckets = bolgeBucketsFor(avciPos);
        for (const kacakPos of world.titles) {
          const sets: Set<PageTitle>[] = combo.map((t) => {
            if (t === "hareket") return fullSet;
            if (t === "kategori")
              return kategoriBuckets.get(kategoriValue.get(kacakPos)!) ?? new Set();
            if (t === "harf") return harfBuckets.get(harfValue.get(kacakPos)!) ?? new Set();
            if (t === "derece") return dereceBuckets.get(dereceValue.get(kacakPos)!) ?? new Set();
            const band = bolgeSlice(world, avciPos, kacakPos)!;
            return bolgeBuckets.get(band) ?? new Set();
          });
          counts.push(intersectSize(sets));
        }
      }
    }

    results.push({ combo, mean: mean(counts), median: median(counts), p90: p90(counts) });
  }

  results.sort((a, b) => a.median - b.median);

  console.log(`Kombinasyon → aday sayısı (ortalama / medyan / %90), küçükten büyüğe (medyan):\n`);
  for (const r of results) {
    console.log(
      `  [${r.combo.join("+").padEnd(28)}] ort=${r.mean.toFixed(1).padStart(7)} medyan=${r.median.toFixed(1).padStart(7)} p90=${r.p90.toFixed(1).padStart(7)}`
    );
  }

  const singles = results.filter((r) => r.combo.length === 1);
  const priorityOrder = singles.sort((a, b) => a.median - b.median).map((r) => r.combo[0]);
  console.log(`\nTekil dilimlerin daraltma gücüne göre öncelik sırası (medyan artan): ${priorityOrder.join(" > ")}`);

  return priorityOrder;
}

interface MatchMetrics {
  status: MatchState["status"];
  turnsPlayed: number;
}

function runFilterHunterMatch(
  world: WorldData,
  pages: WorldPage[],
  seed: number,
  kacakBot: KacakBotFn,
  N: number,
  K: number,
  priorityOrder: SliceType[],
  esikler: DereceEsikleri
): MatchMetrics {
  let state = setupMatch(world, {
    seed,
    kacakSpecializations: [],
    avciSpecializations: [],
    turnLimit: DEFAULT_TURN_LIMIT,
  });
  const botRng = createRng(seed);
  const hakem = createSliceHakemStub(world, () => state, esikler);
  const hunter = createFilterHunterAvci(world, pages, { N, K, priorityOrder, esikler });
  const neutralHakem = createStubHakemKanali();

  const SAFETY_CAP = state.turnLimit + 10;
  let iterations = 0;

  while (state.status === "devam" && iterations < SAFETY_CAP) {
    const kView = kacakView(world, state);
    const kMove = kacakBot(kView, botRng);

    const sliceTypesAsked = hunter.sliceTypesToAskThisTurn();
    const cevaplar = sliceTypesAsked.map((t) => hakem.mesajGonder("avci", t));
    hunter.recordAnswers(sliceTypesAsked, cevaplar);

    const aView = avciView(world, state);
    const aMove: AvciMove = hunter.decide(aView);

    const result = processTurn(world, state, kMove, aMove, neutralHakem, {});
    state = result.state;
    iterations++;
  }

  return { status: state.status, turnsPlayed: state.turn - 1 };
}

function runPhase3(
  world: WorldData,
  pages: WorldPage[],
  priorityOrder: SliceType[],
  esikler: DereceEsikleri
) {
  console.log(`\n=== FAZ 3: Filtre-Avcı Ölçümü (${N_SEEDS} tohum/hücre) ===\n`);

  const kacakBots: { name: string; fn: KacakBotFn }[] = [
    { name: "kal", fn: stayKacak },
    { name: "rastgeleGezen", fn: wanderingKacak },
  ];
  const Ns = [1, 2, 3, 5];
  const Ks = [1, 3];

  console.log(`Dilim önceliği (N seçimi bundan): ${priorityOrder.join(" > ")}\n`);

  const rows: { N: number; K: number; kacak: string; winRate: number; avgTurns: number }[] = [];

  for (const N of Ns) {
    for (const K of Ks) {
      for (const kacak of kacakBots) {
        let wins = 0;
        let totalTurns = 0;
        for (let seed = 0; seed < N_SEEDS; seed++) {
          const m = runFilterHunterMatch(world, pages, seed, kacak.fn, N, K, priorityOrder, esikler);
          if (m.status === "avciKazandi") wins++;
          totalTurns += m.turnsPlayed;
        }
        rows.push({
          N,
          K,
          kacak: kacak.name,
          winRate: wins / N_SEEDS,
          avgTurns: totalTurns / N_SEEDS,
        });
      }
    }
  }

  console.log(`N  K  Kaçak            Kazanma%   OrtTur`);
  for (const r of rows) {
    console.log(
      `${String(r.N).padEnd(3)}${String(r.K).padEnd(3)}${r.kacak.padEnd(17)}%${(r.winRate * 100).toFixed(1).padStart(6)}   ${r.avgTurns.toFixed(1)}`
    );
  }

  console.log(`\n=== G2B ile karşılaştırma ===`);
  console.log(`G2B BANT-tırmanıcı Avcı: kal=%0.0, rastgeleGezen=%4.0, yuksekDereceli=%2.0 (ort. %2.0)`);
  console.log(`G2B TAM-açgözlü Avcı (üst sınır): kal=%100.0, rastgeleGezen=%58.3, yuksekDereceli=%100.0 (ort. %86.1)`);

  console.log(`\n=== %20-60 hedef aralığı yorumu (zorlanmadı) ===`);
  for (const r of rows) {
    const inRange = r.winRate >= 0.2 && r.winRate <= 0.6;
    console.log(
      `N=${r.N} K=${r.K} ${r.kacak}: %${(r.winRate * 100).toFixed(1)} — ${inRange ? "hedef aralıkta" : "aralık dışı"}`
    );
  }

  return rows;
}

function main() {
  console.log(`Dünya yükleniyor: ${WORLD_FILE}`);
  const world = loadWorldFromFile(WORLD_FILE);
  const pages = world.titles.map((t) => world.pages.get(t)!);
  console.log(`${pages.length} sayfa (SCC) yüklendi.`);

  const esikler = computeDereceEsikleri(world);
  const priorityOrder = runPhase2(world, pages, esikler);
  runPhase3(world, pages, priorityOrder, esikler);
}

main();
