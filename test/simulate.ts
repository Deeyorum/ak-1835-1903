import * as path from "path";
import { loadWorldFromFile } from "./loadWorldFile";
import { setupMatch, DEFAULT_TURN_LIMIT } from "../src/game/setup";
import { processTurn } from "../src/game/engine";
import { kacakView, avciView } from "../src/game/views";
import { createStubHakemKanali } from "../src/game/hakemKanali";
import { createRng, type Rng } from "../src/game/rng";
import { randomKacak, randomAvci, stayKacak } from "./bots";
import type { MatchState, AvciMove, KacakMove } from "../src/game/types";
import type { WorldData } from "../src/game/world";
import type { KacakView, AvciView } from "../src/game/views";

const WORLD_FILE = path.join(__dirname, "../world/world.scc.json");

interface RunResult {
  finalState: MatchState;
  iterations: number;
  hitSafetyCap: boolean;
}

function runMatch(
  world: WorldData,
  seed: number,
  kacakBot: (v: KacakView, rng: Rng) => KacakMove,
  avciBot: (v: AvciView, rng: Rng) => AvciMove
): RunResult {
  let state = setupMatch(world, {
    seed,
    kacakSpecializations: [],
    avciSpecializations: [],
    turnLimit: DEFAULT_TURN_LIMIT,
  });
  const botRng = createRng(seed);
  const hakem = createStubHakemKanali();
  const SAFETY_CAP = state.turnLimit + 10;
  let iterations = 0;

  while (state.status === "devam" && iterations < SAFETY_CAP) {
    const kMove = kacakBot(kacakView(world, state), botRng);
    const aMove = avciBot(avciView(world, state), botRng);
    const result = processTurn(world, state, kMove, aMove, hakem);
    state = result.state;
    iterations++;
  }

  return { finalState: state, iterations, hitSafetyCap: iterations >= SAFETY_CAP };
}

function main() {
  console.log(`Dünya yükleniyor: ${WORLD_FILE}`);
  const world = loadWorldFromFile(WORLD_FILE);
  console.log(`${world.titles.length} sayfa yüklendi.\n`);

  const N = 200;
  let terminatedCount = 0;
  let safetyCapHits = 0;
  let avciWins = 0;
  let kacakWins = 0;
  let turnLimitEnforcedCorrectly = 0;

  for (let seed = 0; seed < N; seed++) {
    const { finalState, hitSafetyCap } = runMatch(world, seed, randomKacak, randomAvci);
    if (finalState.status !== "devam") terminatedCount++;
    if (hitSafetyCap) safetyCapHits++;
    if (finalState.status === "avciKazandi") avciWins++;
    if (finalState.status === "kacakKazandi") kacakWins++;
    if (finalState.status === "kacakKazandi" && finalState.turn - 1 === finalState.turnLimit) {
      turnLimitEnforcedCorrectly++;
    }
  }

  console.log(`=== 200 tohumlu maç (rastgele Kaçak vs rastgele Avcı) ===`);
  console.log(`Biten maç sayısı: ${terminatedCount}/${N}`);
  console.log(`Güvenlik sınırına çarpan (olası sonsuz döngü): ${safetyCapHits}/${N}`);
  console.log(`Avcı kazandı: ${avciWins}/${N} (%${((avciWins / N) * 100).toFixed(1)})`);
  console.log(`Kaçak kazandı (tur sınırı): ${kacakWins}/${N} (%${((kacakWins / N) * 100).toFixed(1)})`);
  console.log(
    `Tur sınırı doğru uygulanan Kaçak-kazanma: ${turnLimitEnforcedCorrectly}/${kacakWins}`
  );

  // Tur sınırı özel testi: "kal" Kaçak + asla yakalamayan Avcı -> kesin tur sınırı.
  const neverCatchAvci = (view: AvciView, rng: Rng): AvciMove => {
    if (view.komsular.length === 0) return { type: "yakala" };
    return { type: "git", to: rng.pick(view.komsular) };
  };
  const { finalState: stayResult } = runMatch(world, 42, stayKacak, neverCatchAvci);
  const turnLimitOk =
    stayResult.status === "kacakKazandi" && stayResult.turn - 1 === stayResult.turnLimit;
  console.log(`\n=== Tur sınırı testi ("kal" Kaçak + hiç yakalamayan Avcı, seed=42) ===`);
  console.log(`Durum: ${stayResult.status}, işlenen tur: ${stayResult.turn - 1}`);
  console.log(`Tur sınırı doğru çalışıyor: ${turnLimitOk ? "EVET" : "HAYIR"}`);

  // Determinizm testi: aynı tohum, aynı maç kaydı.
  const run1 = runMatch(world, 7, randomKacak, randomAvci);
  const run2 = runMatch(world, 7, randomKacak, randomAvci);
  const deterministic =
    JSON.stringify(run1.finalState.log) === JSON.stringify(run2.finalState.log);
  console.log(`\n=== Determinizm testi (seed=7, iki kez çalıştırıldı) ===`);
  console.log(`Aynı kayıt üretiyor: ${deterministic ? "EVET" : "HAYIR"}`);

  const allOk =
    terminatedCount === N && safetyCapHits === 0 && turnLimitOk && deterministic;

  console.log(`\n=== SONUÇ ===`);
  console.log(allOk ? "✓ Tüm kontroller geçti." : "✗ BAZI KONTROLLER BAŞARISIZ.");
  if (!allOk) process.exit(1);
}

main();
