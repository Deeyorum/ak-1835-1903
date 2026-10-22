import * as path from "path";
import { loadWorldFromFile } from "./loadWorldFile";
import { kacakView, avciView } from "../src/game/views";
import type { MatchState } from "../src/game/types";

const WORLD_FILE = path.join(__dirname, "../world/world.scc.json");

function baseState(kacakPos: string, avciPos: string): MatchState {
  return {
    seed: 1,
    turn: 5,
    turnLimit: 30,
    kacakPosition: kacakPos,
    avciPosition: avciPos,
    kacakSpecializations: ["haritaci"],
    avciSpecializations: ["profilci"],
    kacakStayStreak: 2,
    kacakMoveCount: 2,
    kacakStayCount: 2,
    status: "devam",
    log: [],
  };
}

function main() {
  const world = loadWorldFromFile(WORLD_FILE);
  const titles = world.titles;

  // Kaçak'ın sabit, Avcı'nın konumu değişen iki durum: kacakView bu
  // ikisinde AYNI çıkmalı (Avcı'nın konumuna bağlı hiçbir bilgi yok).
  const kacakFixed = titles[0];
  const avciA = titles[1];
  const avciB = titles[2];

  const stateA = baseState(kacakFixed, avciA);
  const stateB = baseState(kacakFixed, avciB);

  const viewA = kacakView(world, stateA);
  const viewB = kacakView(world, stateB);

  const kacakLeakFree = JSON.stringify(viewA) === JSON.stringify(viewB);
  const kacakViewContainsAvciPos =
    JSON.stringify(viewA).includes(avciA) || JSON.stringify(viewA).includes(avciB);

  console.log(`=== Kaçak görünümü sızıntı testi ===`);
  console.log(`Avcı konumu değiştiğinde kacakView değişmiyor: ${kacakLeakFree ? "EVET" : "HAYIR"}`);
  console.log(`kacakView çıktısı Avcı'nın konum string'ini içeriyor mu: ${kacakViewContainsAvciPos ? "EVET (ŞÜPHELİ)" : "HAYIR"}`);

  // Simetrik test: Avcı sabit, Kaçak'ın konumu değişen iki durum.
  const avciFixed = titles[3];
  const kacakA = titles[4];
  const kacakB = titles[5];

  const stateC = baseState(kacakA, avciFixed);
  const stateD = baseState(kacakB, avciFixed);

  const viewC = avciView(world, stateC);
  const viewD = avciView(world, stateD);

  const avciLeakFree = JSON.stringify(viewC) === JSON.stringify(viewD);
  const avciViewContainsKacakPos =
    JSON.stringify(viewC).includes(kacakA) || JSON.stringify(viewC).includes(kacakB);

  console.log(`\n=== Avcı görünümü sızıntı testi ===`);
  console.log(`Kaçak konumu değiştiğinde avciView değişmiyor: ${avciLeakFree ? "EVET" : "HAYIR"}`);
  console.log(`avciView çıktısı Kaçak'ın konum string'ini içeriyor mu: ${avciViewContainsKacakPos ? "EVET (ŞÜPHELİ)" : "HAYIR"}`);

  const allOk = kacakLeakFree && !kacakViewContainsAvciPos && avciLeakFree && !avciViewContainsKacakPos;
  console.log(`\n=== SONUÇ ===`);
  console.log(allOk ? "✓ Sızıntı yok." : "✗ SIZINTI TESPİT EDİLDİ.");
  if (!allOk) process.exit(1);
}

main();
