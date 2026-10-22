import { createRng } from "./rng";
import { distancesTo, type WorldData } from "./world";
import type { MatchConfig, MatchState, Specialization } from "./types";
import { ALL_SPECIALIZATIONS, MAX_SPECIALIZATIONS } from "./types";

export const DEFAULT_TURN_LIMIT = 30;
export const MIN_AVCI_DISTANCE = 4;

export function validateSpecializations(specs: Specialization[]): void {
  if (specs.length > MAX_SPECIALIZATIONS) {
    throw new Error(
      `En çok ${MAX_SPECIALIZATIONS} uzmanlık beyan edilebilir, ${specs.length} verildi.`
    );
  }
  for (const s of specs) {
    if (!ALL_SPECIALIZATIONS.includes(s)) {
      throw new Error(`Geçersiz uzmanlık: ${s}`);
    }
  }
  if (new Set(specs).size !== specs.length) {
    throw new Error("Aynı uzmanlık birden çok kez beyan edilemez.");
  }
}

/**
 * Seeded match setup. Kaçak başlangıç sayfası rastgele; Avcı başlangıç
 * sayfası, Kaçak'a yönlü (Avcı -> Kaçak) en az MIN_AVCI_DISTANCE hop
 * uzaklıkta seçilir (SPEC §4: "Avcı Kaçak'a ... uzakta" — Avcı'nın
 * Kaçak'a erişmesi gereken mesafe, yani dist(avci, kacak)).
 */
export function setupMatch(world: WorldData, config: MatchConfig): MatchState {
  validateSpecializations(config.kacakSpecializations);
  validateSpecializations(config.avciSpecializations);

  const rng = createRng(config.seed);
  const kacakPosition = rng.pick(world.titles);

  /**
   * "Birçok kaynak (t), tek hedef (kacakPosition)" deseni — `distance()`'ı
   * 1295 kez döngüde çağırmak yerine TEK bir ters BFS (G4A, bkz.
   * DEFTER.md). Filtre mantığı ve `world.titles` üzerindeki sıra
   * DEĞİŞMEDİ — aynı tohum için `candidates` dizisi ve dolayısıyla
   * `rng.pick(candidates)` sonucu birebir aynı kalır.
   */
  const distTo = distancesTo(world, kacakPosition);
  const candidates = world.titles.filter(
    (t) => t !== kacakPosition && (distTo.get(t) ?? -1) >= MIN_AVCI_DISTANCE
  );
  if (candidates.length === 0) {
    throw new Error(
      `Kaçak konumu (${kacakPosition}) için ${MIN_AVCI_DISTANCE}+ hop uzaklıkta Avcı başlangıcı bulunamadı.`
    );
  }
  const avciPosition = rng.pick(candidates);

  return {
    seed: config.seed,
    turn: 1,
    turnLimit: config.turnLimit ?? DEFAULT_TURN_LIMIT,
    kacakPosition,
    avciPosition,
    kacakSpecializations: config.kacakSpecializations,
    avciSpecializations: config.avciSpecializations,
    kacakStayStreak: 0,
    kacakMoveCount: 0,
    kacakStayCount: 0,
    status: "devam",
    log: [],
  };
}
