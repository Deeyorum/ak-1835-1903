import type { AvciMove, PageTitle, WorldPage } from "../../src/game/types";
import type { AvciView } from "../../src/game/views";
import { distance, type WorldData } from "../../src/game/world";
import { filterByCandidate, type SliceType, type DereceEsikleri } from "../slices";

export interface FilterHunterConfig {
  /** Kullanılacak dilim sayısı (öncelik sırasının ilk N'i). */
  N: number;
  /** Tur başına soru bütçesi. */
  K: number;
  /** Faz 2'de belirlenen, daraltma gücüne göre sıralı dilim listesi. */
  priorityOrder: SliceType[];
  esikler: DereceEsikleri;
}

export interface FilterHunterController {
  /** Bu tur sorulacak dilim türleri (K kadar, döngüsel). Hakem Q&A,
   * üretim motorunun hakem-mesaj kotasından (taban 1, Arabulucu ile en
   * çok 2) BAĞIMSIZ olarak test harness'i tarafından doğrudan
   * hakem.mesajGonder() ile çağrılır — K=3 ölçümü üretim kotasıyla ifade
   * edilemediği için (bu bir SPEC/motor değişikliği değildir, yalnız
   * ölçüm harness'inin HakemKanali'yi kota-dışı kullanması). */
  sliceTypesToAskThisTurn(): SliceType[];
  recordAnswers(sliceTypesAsked: SliceType[], cevaplar: string[]): void;
  decide(view: AvciView): AvciMove;
}

/**
 * Filtre-Avcı: tur başına K dilim sorar (N'lik öncelik listesinden
 * döngüsel olarak), bilinen tüm dilimlerle TUTARLI aday sayfa kümesini
 * hesaplar, en yakın adaya yönelir, üzerindeyse yakalamayı dener.
 *
 * Tazelik modeli (G2C tasarım kararı): Kaçak hareket ettiğinde statik
 * dilimler (kategori/harf/derece) geçersiz kalabilir ama bot bunu
 * doğrudan GÖRMEZ (sızıntı olur). Bunun yerine tüm N dilimi sürekli
 * döngüsel olarak yeniden sorar (round-robin) — en geç ceil(N/K) tur
 * içinde her dilim tazelenir, böylece bayatlık sınırlı kalır, ayrıca
 * "hareket ettiyse yeniden hesapla" gereksinimini açık hareket-algılama
 * olmadan doğal şekilde karşılar.
 */
export function createFilterHunterAvci(
  world: WorldData,
  allPages: WorldPage[],
  config: FilterHunterConfig
): FilterHunterController {
  const activeSlices = config.priorityOrder.slice(0, config.N);
  const known = new Map<SliceType, unknown>();
  let rrPointer = 0;

  function candidateSet(avciPos: PageTitle): WorldPage[] {
    let candidates = allPages;
    for (const sliceType of activeSlices) {
      if (!known.has(sliceType)) continue;
      candidates = filterByCandidate(world, candidates, sliceType, known.get(sliceType), {
        avciPos,
        esikler: config.esikler,
      });
    }
    return candidates;
  }

  return {
    sliceTypesToAskThisTurn(): SliceType[] {
      if (activeSlices.length === 0) return [];
      const toAsk: SliceType[] = [];
      for (let i = 0; i < config.K && i < activeSlices.length; i++) {
        toAsk.push(activeSlices[(rrPointer + i) % activeSlices.length]);
      }
      rrPointer = (rrPointer + Math.min(config.K, activeSlices.length)) % activeSlices.length;
      return toAsk;
    },

    recordAnswers(sliceTypesAsked: SliceType[], cevaplar: string[]) {
      for (let i = 0; i < sliceTypesAsked.length && i < cevaplar.length; i++) {
        const sliceType = sliceTypesAsked[i];
        const raw = cevaplar[i];
        const value: unknown = sliceType === "hareket" ? Number(raw) : raw;
        known.set(sliceType, value);
      }
    },

    decide(view: AvciView): AvciMove {
      const candidates = candidateSet(view.kendiKonum);

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

      if (target === null || view.komsular.length === 0) {
        return { type: "yakala" };
      }

      let bestNeighbor: PageTitle | null = null;
      let bestNeighborDist = Infinity;
      for (const n of view.komsular) {
        const d = distance(world, n, target) ?? Infinity;
        if (d < bestNeighborDist) {
          bestNeighborDist = d;
          bestNeighbor = n;
        }
      }

      if (bestNeighbor === null) {
        return { type: "yakala" };
      }
      return { type: "git", to: bestNeighbor };
    },
  };
}
