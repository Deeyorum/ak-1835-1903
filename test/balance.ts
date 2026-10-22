import * as path from "path";
import { loadWorldFromFile } from "./loadWorldFile";
import { setupMatch, DEFAULT_TURN_LIMIT } from "../src/game/setup";
import { processTurn } from "../src/game/engine";
import { kacakView, avciView } from "../src/game/views";
import { createStubHakemKanali } from "../src/game/hakemKanali";
import { createRng } from "../src/game/rng";
import { distance, type WorldData } from "../src/game/world";
import type { AvciMove, MatchState } from "../src/game/types";
import { createBandHakemStub, createExactHakemStub, bandOf, type Band } from "./testHakem";
import { stayKacak, wanderingKacak, createHighDegreeKacak, type KacakBotFn } from "./bots/kacakBots";
import {
  randomAvci,
  createBandClimberAvci,
  greedyExactAvci,
  type AvciController,
} from "./bots/avciBots";

const WORLD_FILE = path.join(__dirname, "../world/world.scc.json");
const N_SEEDS = 300;

type AvciBotName = "rastgele" | "bantTirmanici" | "tamAcgozlu";
type KacakBotName = "kal" | "rastgeleGezen" | "yuksekDereceli";

interface MatchMetrics {
  status: MatchState["status"];
  turnsPlayed: number;
  distanceSamples: number[];
}

function runMatch(
  world: WorldData,
  seed: number,
  avciBotName: AvciBotName,
  kacakBot: KacakBotFn
): MatchMetrics {
  let state = setupMatch(world, {
    seed,
    kacakSpecializations: [],
    avciSpecializations: [],
    turnLimit: DEFAULT_TURN_LIMIT,
  });
  const botRng = createRng(seed);
  const distanceSamples: number[] = [];

  const bandController: AvciController | null =
    avciBotName === "bantTirmanici" ? createBandClimberAvci() : null;

  const hakem =
    avciBotName === "bantTirmanici"
      ? createBandHakemStub(world, () => state)
      : avciBotName === "tamAcgozlu"
        ? createExactHakemStub(world, () => state)
        : createStubHakemKanali();

  const SAFETY_CAP = state.turnLimit + 10;
  let iterations = 0;
  let consistencyMismatches = 0;

  while (state.status === "devam" && iterations < SAFETY_CAP) {
    const d = distance(world, state.avciPosition, state.kacakPosition);
    distanceSamples.push(d ?? -1);

    const kView = kacakView(world, state);
    const aView = avciView(world, state);
    const kMove = kacakBot(kView, botRng);

    let aMove: AvciMove;
    let avciHakemMesajlari: string[] = [];

    if (avciBotName === "rastgele") {
      aMove = randomAvci(aView, botRng);
    } else if (avciBotName === "bantTirmanici" && bandController) {
      const decision = bandController.decide(aView, botRng);
      aMove = decision.move;
      avciHakemMesajlari = decision.hakemSorular;
    } else {
      aMove = greedyExactAvci(world, aView, state.kacakPosition);
      avciHakemMesajlari = ["Kaçak'a tam mesafen ne?"];
    }

    const result = processTurn(world, state, kMove, aMove, hakem, { avciHakemMesajlari });

    const cevaplar = result.logEntry.hakemMesajlari
      .filter((m) => m.gonderen === "avci")
      .map((m) => m.yanit);

    if (avciBotName === "bantTirmanici" && bandController) {
      bandController.onHakemCevaplar(cevaplar);
    } else if (avciBotName === "tamAcgozlu" && cevaplar.length > 0) {
      const reported = Number(cevaplar[0]);
      if (d !== undefined && reported !== d) consistencyMismatches++;
    }

    state = result.state;
    iterations++;
  }

  if (consistencyMismatches > 0) {
    console.warn(
      `  ! TAM hakem stub tutarsızlığı: ${consistencyMismatches} tur (seed=${seed})`
    );
  }

  return { status: state.status, turnsPlayed: state.turn - 1, distanceSamples };
}

function entropy(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

function bandCounts(
  distances: number[],
  thresholds: { yakin: number; orta: number }
): { yakın: number; orta: number; uzak: number } {
  const out = { yakın: 0, orta: 0, uzak: 0 };
  for (const d of distances) {
    if (d < 0) continue; // unreachable (should not occur within SCC)
    if (d <= thresholds.yakin) out.yakın++;
    else if (d <= thresholds.orta) out.orta++;
    else out.uzak++;
  }
  return out;
}

function main() {
  console.log(`Dünya yükleniyor: ${WORLD_FILE}`);
  const world = loadWorldFromFile(WORLD_FILE);
  console.log(`${world.titles.length} sayfa (SCC) yüklendi.\n`);

  const highDegreeKacak = createHighDegreeKacak(world);

  const avciBots: { name: AvciBotName; label: string }[] = [
    { name: "rastgele", label: "Rastgele Avcı" },
    { name: "bantTirmanici", label: "BANT-tırmanıcı Avcı" },
    { name: "tamAcgozlu", label: "TAM-açgözlü Avcı" },
  ];
  const kacakBots: { name: KacakBotName; fn: KacakBotFn; label: string }[] = [
    { name: "kal", fn: stayKacak, label: "Kal Kaçak" },
    { name: "rastgeleGezen", fn: wanderingKacak, label: "Rastgele gezen Kaçak" },
    { name: "yuksekDereceli", fn: highDegreeKacak, label: "Yüksek-dereceli Kaçak" },
  ];

  const table: Record<string, Record<string, { winRate: number; avgTurns: number }>> = {};
  const allDistanceSamples: number[] = [];
  const startDistanceSamples: number[] = [];

  for (const avci of avciBots) {
    table[avci.name] = {};
    for (const kacak of kacakBots) {
      let avciWins = 0;
      let totalTurns = 0;
      for (let seed = 0; seed < N_SEEDS; seed++) {
        const m = runMatch(world, seed, avci.name, kacak.fn);
        if (m.status === "avciKazandi") avciWins++;
        totalTurns += m.turnsPlayed;
        allDistanceSamples.push(...m.distanceSamples);
        if (m.distanceSamples.length > 0) startDistanceSamples.push(m.distanceSamples[0]);
      }
      table[avci.name][kacak.name] = {
        winRate: avciWins / N_SEEDS,
        avgTurns: totalTurns / N_SEEDS,
      };
    }
  }

  console.log(`=== 3×3 Tablo (${N_SEEDS} tohumlu maç / hücre, Avcı kazanma oranı / ort. tur) ===\n`);
  const colWidth = 24;
  const header = ["".padEnd(22), ...kacakBots.map((k) => k.label.padEnd(colWidth))].join("");
  console.log(header);
  for (const avci of avciBots) {
    const row = [avci.label.padEnd(22)];
    for (const kacak of kacakBots) {
      const cell = table[avci.name][kacak.name];
      row.push(
        `%${(cell.winRate * 100).toFixed(1)} / ${cell.avgTurns.toFixed(1)}t`.padEnd(colWidth)
      );
    }
    console.log(row.join(""));
  }

  // Bant eşik / entropi analizi
  console.log(`\n=== Bant eşik analizi (SPEC §6: yakın ≤2 / orta 3-4 / uzak ≥5) ===`);
  const defaultThresh = { yakin: 2, orta: 4 };
  const altThresh = { yakin: 1, orta: 3 };

  function report(label: string, samples: number[]) {
    const def = bandCounts(samples, defaultThresh);
    const alt = bandCounts(samples, altThresh);
    const total = samples.filter((d) => d >= 0).length;
    const defEntropy = entropy([def.yakın, def.orta, def.uzak]);
    const altEntropy = entropy([alt.yakın, alt.orta, alt.uzak]);

    console.log(`\n-- ${label} (n=${total}) --`);
    console.log(
      `  Varsayılan (≤2/3-4/≥5): yakın=%${((def.yakın / total) * 100).toFixed(1)} orta=%${((def.orta / total) * 100).toFixed(1)} uzak=%${((def.uzak / total) * 100).toFixed(1)} | entropi=${defEntropy.toFixed(3)} bit`
    );
    console.log(
      `  Alternatif (≤1/2-3/≥4): yakın=%${((alt.yakın / total) * 100).toFixed(1)} orta=%${((alt.orta / total) * 100).toFixed(1)} uzak=%${((alt.uzak / total) * 100).toFixed(1)} | entropi=${altEntropy.toFixed(3)} bit`
    );

    const ortaPercent = (def.orta / total) * 100;
    if (ortaPercent > 60) {
      console.log(
        `  ⚠ Orta bant %60'ı aşıyor (%${ortaPercent.toFixed(1)}). Öneri: ${altEntropy > defEntropy ? "ALTERNATİF eşikler (daha yüksek entropi)" : "varsayılan eşikler zaten daha iyi entropili, değişiklik önerilmez"}.`
      );
    } else {
      console.log(`  Orta bant %60 eşiğinin altında (%${ortaPercent.toFixed(1)}), eşik değişikliği gerekmez.`);
    }
  }

  report("Maç başı (her maçın 1. turu)", startDistanceSamples);
  report("Tüm turlar (tüm maçlar)", allDistanceSamples);

  // Hedef aralık yorumu
  console.log(`\n=== Avcı kazanma oranı hedef aralığı (~%20-60) yorumu ===`);
  for (const avci of avciBots) {
    const rates = kacakBots.map((k) => table[avci.name][k.name].winRate);
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
    const inRange = avgRate >= 0.2 && avgRate <= 0.6;
    console.log(
      `${avci.label}: ortalama kazanma oranı %${(avgRate * 100).toFixed(1)} — ${inRange ? "hedef aralıkta" : "HEDEF ARALIK DIŞINDA"}`
    );
  }
}

main();
