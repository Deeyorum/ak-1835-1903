import type { AvciMove, PageTitle } from "../../src/game/types";
import type { AvciView } from "../../src/game/views";
import type { Rng } from "../../src/game/rng";
import { distance, type WorldData } from "../../src/game/world";
import type { Band } from "../testHakem";
import { randomAvci } from "../bots";

/** Rastgele Avcı — test/bots.ts'teki mevcut bot, G2B 3×3 tablosunda yeniden kullanılır. */
export { randomAvci };

export interface AvciController {
  /** Bu turun hamlesini ve (varsa) hakeme sorulacak soru(ları) döner. */
  decide(view: AvciView, rng: Rng): { move: AvciMove; hakemSorular: string[] };
  /** Önceki turda sorulan sorulara gelen yanıtlar, sırayla; bir sonraki
   * decide() çağrısından ÖNCE verilir. */
  onHakemCevaplar(cevaplar: string[]): void;
}

function bandRank(b: Band): number {
  return b === "yakın" ? 0 : b === "orta" ? 1 : 2;
}

/**
 * BANT-tırmanıcı: bir komşuya geç, bant sor (tur başına en çok 1 soru),
 * iyileşmediyse geri dön. Bant "yakın" ise yakalamayı dener.
 */
export function createBandClimberAvci(): AvciController {
  let lastBand: Band | null = null;
  let improvedLastTime = true;
  let cameFrom: PageTitle | null = null;

  return {
    decide(view: AvciView, rng: Rng): { move: AvciMove; hakemSorular: string[] } {
      if (lastBand === "yakın") {
        // Yakalamayı bir kez dener; başarısız olursa (bir sonraki decide
        // çağrısına kadar maç bitmediyse) bandı sıfırlayıp yeniden
        // sormaya döner — aksi halde yakala hiç soru sormadığı için
        // lastBand hep "yakın" kalır ve bot sonsuza dek aynı başarısız
        // yakalamayı tekrarlar (sıkışma hatası, bulunup düzeltildi).
        lastBand = null;
        cameFrom = null;
        return { move: { type: "yakala" }, hakemSorular: [] };
      }
      if (view.komsular.length === 0) {
        // Avcı'nın "kal" seçeneği yok (SPEC §4) — komşusuz kaldıysa yakalamayı dener.
        return { move: { type: "yakala" }, hakemSorular: [] };
      }

      let target: PageTitle;
      if (lastBand === null || improvedLastTime) {
        const candidates = cameFrom
          ? view.komsular.filter((n) => n !== cameFrom)
          : view.komsular;
        const pool = candidates.length > 0 ? candidates : view.komsular;
        target = rng.pick(pool);
      } else {
        target = cameFrom ?? rng.pick(view.komsular);
      }

      cameFrom = view.kendiKonum;
      return {
        move: { type: "git", to: target },
        hakemSorular: ["Kaçak'a mesafe bandın ne?"],
      };
    },

    onHakemCevaplar(cevaplar: string[]) {
      if (cevaplar.length === 0) return;
      const newBand = cevaplar[0] as Band;
      if (lastBand !== null) {
        improvedLastTime = bandRank(newBand) < bandRank(lastBand);
      }
      lastBand = newBand;
    },
  };
}

/**
 * TAM-açgözlü: komşular arasında Kaçak'a mesafeyi azaltanı seçer.
 * ÜST SINIR ÖLÇÜMÜ — gerçekçi bir Avcı değildir, her komşu için ayrı
 * mesafe bilgisine (idealize edilmiş, tek-soru kotasının ötesinde)
 * erişir. world.distances üzerinden hesaplar; bu dünya yapısı kamuya
 * açıktır, yalnız Kaçak'ın GERÇEK KONUMU ayrıcalıklı olarak sağlanır
 * (oracle) — gerçek oyunda bu bilgi mevcut olmayacaktır.
 */
export function greedyExactAvci(
  world: WorldData,
  view: AvciView,
  kacakPositionOracle: PageTitle
): AvciMove {
  const d0 = distance(world, view.kendiKonum, kacakPositionOracle) ?? Infinity;
  if (d0 === 0) return { type: "yakala" };

  let best: PageTitle | null = null;
  let bestDist = d0;
  for (const n of view.komsular) {
    const d = distance(world, n, kacakPositionOracle) ?? Infinity;
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  if (best === null) {
    return { type: "yakala" };
  }
  return { type: "git", to: best };
}
