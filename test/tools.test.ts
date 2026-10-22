import * as path from "path";
import { loadWorldFromFile } from "./loadWorldFile";
import { setupMatch, validateSpecializations } from "../src/game/setup";
import { kullanUzmanlikArac } from "../src/game/tools";
import type { MatchState } from "../src/game/types";

const WORLD_FILE = path.join(__dirname, "../world/world.scc.json");

function main() {
  const world = loadWorldFromFile(WORLD_FILE);
  let failures = 0;

  // 1) En çok 2 uzmanlık — 3. beyan hata vermeli.
  try {
    validateSpecializations(["haritaci", "dilbilimci", "profilci"]);
    console.log("✗ 3 uzmanlık beyanı hata VERMEDİ (olması gerekirdi)");
    failures++;
  } catch {
    console.log("✓ 3 uzmanlık beyanı reddedildi");
  }

  // 2) Beyan edilmemiş aracın çağrılması ok:false döndürmeli.
  const state: MatchState = setupMatch(world, {
    seed: 3,
    kacakSpecializations: ["haritaci"],
    avciSpecializations: ["profilci"],
  });

  const undeclared = kullanUzmanlikArac(world, state, "kacak", "dilbilimci", {});
  if (undeclared.ok) {
    console.log("✗ Beyan edilmemiş araç (dilbilimci) çağrıldı ama KABUL edildi");
    failures++;
  } else {
    console.log(`✓ Beyan edilmemiş araç reddedildi: ${undeclared.reason}`);
  }

  // 3) Beyan edilmiş aracın çalışması.
  const haritaci = kullanUzmanlikArac(world, state, "kacak", "haritaci", {});
  if (!haritaci.ok || typeof haritaci.sonuc !== "number") {
    console.log("✗ Haritacı (Kaçak) beklenen sayısal sonucu döndürmedi");
    failures++;
  } else {
    console.log(`✓ Haritacı (Kaçak) sonuç: ${haritaci.sonuc} (bağlantı derecesi)`);
  }

  const profilci = kullanUzmanlikArac(world, state, "avci", "profilci", {});
  if (!profilci.ok) {
    console.log("✗ Profilci (Avcı) başarısız");
    failures++;
  } else {
    console.log(`✓ Profilci (Avcı) sonuç: ${JSON.stringify(profilci.sonuc)}`);
  }

  const dilbilimciKacak = kullanUzmanlikArac(world, state, "kacak", "haritaci", {});
  console.log(`(bilgi) Kaçak haritaci tekrar: ${JSON.stringify(dilbilimciKacak)}`);

  console.log(`\n=== SONUÇ ===`);
  console.log(failures === 0 ? "✓ Tüm araç testleri geçti." : `✗ ${failures} test BAŞARISIZ.`);
  if (failures > 0) process.exit(1);
}

main();
