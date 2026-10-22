import type { KacakMove, PageTitle } from "../../src/game/types";
import type { KacakView } from "../../src/game/views";
import type { Rng } from "../../src/game/rng";
import { distance, outDegree, type WorldData } from "../../src/game/world";
import { stayKacak, randomKacak } from "../bots";

export type KacakBotFn = (view: KacakView, rng: Rng) => KacakMove;

/** "Kal" Kaçak — test/bots.ts'teki mevcut bot, G2B 3×3 tablosunda yeniden kullanılır. */
export { stayKacak };

/** Rastgele gezen Kaçak — test/bots.ts'teki mevcut randomKacak, yeniden kullanılır. */
export { randomKacak as wanderingKacak };

/**
 * En yüksek çıkan-bağlantı dereceli sayfayı (dünya genelinde, bir kez
 * hesaplanır) hedef seçer; her turda hedefe yönlü mesafeyi azaltan
 * komşuya gider, ulaşınca yerinde kalır. Dünya yapısı (hangi sayfanın
 * kaç bağlantısı var) kamuya açık bilgidir — Avcı'nın konumuna
 * BAKMAZ, sadece world.adjacency/world.distances kullanır.
 */
export function createHighDegreeKacak(world: WorldData): KacakBotFn {
  let target: PageTitle | null = null;
  let bestDegree = -1;
  for (const title of world.titles) {
    const d = outDegree(world, title);
    if (d > bestDegree) {
      bestDegree = d;
      target = title;
    }
  }
  if (target === null) {
    throw new Error("Dünyada hiç sayfa yok — highDegreeKacak hedef seçemedi");
  }
  const fixedTarget = target;

  return (view: KacakView, _rng: Rng): KacakMove => {
    if (view.kendiKonum === fixedTarget) return { type: "kal" };

    const currentDist = distance(world, view.kendiKonum, fixedTarget) ?? Infinity;
    let best: PageTitle | null = null;
    let bestDist = currentDist;
    for (const n of view.komsular) {
      const d = distance(world, n, fixedTarget) ?? Infinity;
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    if (best === null) return { type: "kal" };
    return { type: "git", to: best };
  };
}
