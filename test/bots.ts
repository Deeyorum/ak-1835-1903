import type { AvciMove, KacakMove } from "../src/game/types";
import type { AvciView, KacakView } from "../src/game/views";
import type { Rng } from "../src/game/rng";

/** Rastgele Kaçak: %80 rastgele komşuya git, %20 yerinde kal. */
export function randomKacak(view: KacakView, rng: Rng): KacakMove {
  if (view.komsular.length === 0 || rng.next() < 0.2) {
    return { type: "kal" };
  }
  return { type: "git", to: rng.pick(view.komsular) };
}

/** "Kal" Kaçak: her zaman yerinde kalır. */
export function stayKacak(_view: KacakView, _rng: Rng): KacakMove {
  return { type: "kal" };
}

/** Rastgele Avcı: %70 rastgele komşuya git, %30 yakalamayı dener. */
export function randomAvci(view: AvciView, rng: Rng): AvciMove {
  if (view.komsular.length === 0 || rng.next() < 0.3) {
    return { type: "yakala" };
  }
  return { type: "git", to: rng.pick(view.komsular) };
}
