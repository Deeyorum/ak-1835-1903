import * as path from "path";
import { loadWorldFromFile } from "./loadWorldFile";
import type { MatchState, WorldPage } from "../src/game/types";
import {
  DIGER,
  TUM_DILIM_TURLERI,
  bandOf,
  bolgeDilimi,
  dereceDilimi,
  dereceEsikleriHesapla,
  dilimUret,
  dilimeUyanSayfalar,
  harfDilimi,
  hareketDilimi,
  kategoriDilimi,
  kategoriUyeSayilari,
  type DilimBaglami,
} from "../src/game/hakemDilim";
import {
  MAX_PANEL,
  MIN_PANEL,
  hakemPaneliKur,
} from "../src/game/hakemPanel";
// Eski ÖLÇÜM modülü — sapma (drift) karşılaştırması için.
import {
  bandOf as bandOfEski,
  bolgeSlice,
  computeDereceEsikleri,
  dereceSlice,
  harfSlice,
  hareketSlice,
} from "./slices";

const WORLD_FILE = path.join(__dirname, "../world/world.scc.json");

let failures = 0;
function kontrol(ad: string, kosul: boolean, detay = ""): void {
  if (kosul) {
    console.log(`✓ ${ad}${detay === "" ? "" : ` — ${detay}`}`);
  } else {
    console.log(`✗ ${ad}${detay === "" ? "" : ` — ${detay}`}`);
    failures++;
  }
}

function main() {
  const world = loadWorldFromFile(WORLD_FILE);
  const pages: WorldPage[] = world.titles.map((t) => {
    const p = world.pages.get(t);
    if (p === undefined) throw new Error(`Sayfa yok: ${t}`);
    return p;
  });
  const uyeSayilari = kategoriUyeSayilari(pages);
  const esikler = dereceEsikleriHesapla(world);

  console.log(`=== 1) Sapma testi: üretim dilimleri vs test/slices.ts (ölçüm modülü) ===`);

  const eskiEsikler = computeDereceEsikleri(world);
  kontrol(
    "derece eşikleri aynı",
    eskiEsikler.dusukUst === esikler.dusukUst && eskiEsikler.ortaUst === esikler.ortaUst,
    `düşükÜst=${esikler.dusukUst} ortaÜst=${esikler.ortaUst}`
  );

  let harfSapma = 0;
  let dereceSapma = 0;
  for (const p of pages) {
    if (harfDilimi(p.title) !== harfSlice(p.title)) harfSapma++;
    if (dereceDilimi(world, p.title, esikler) !== dereceSlice(world, p.title, eskiEsikler)) {
      dereceSapma++;
    }
  }
  kontrol("harf dilimi sapması yok", harfSapma === 0, `${pages.length} sayfa`);
  kontrol("derece dilimi sapması yok", dereceSapma === 0, `${pages.length} sayfa`);

  let bandSapma = 0;
  for (let d = 0; d <= 12; d++) {
    if (bandOf(d) !== bandOfEski(d)) bandSapma++;
  }
  kontrol("bant eşikleri sapması yok", bandSapma === 0, "d=0..12");

  let bolgeSapma = 0;
  const ornekAvci = world.titles.slice(0, 40);
  for (const a of ornekAvci) {
    for (const k of world.titles.slice(0, 40)) {
      if (bolgeDilimi(world, a, k) !== bolgeSlice(world, a, k)) bolgeSapma++;
    }
  }
  kontrol("bölge dilimi sapması yok", bolgeSapma === 0, "40×40 çift");
  kontrol("hareket dilimi sapması yok", hareketDilimi(7) === hareketSlice(7));

  console.log(`\n=== 2) Kategori kuralı: belirlenimcilik ve başlık elemesi ===`);

  const ornek = pages.slice(0, 200);
  let kararsiz = 0;
  for (const p of ornek) {
    const a = kategoriDilimi(p, uyeSayilari, "uye2");
    const b = kategoriDilimi(p, uyeSayilari, "uye2");
    if (a !== b) kararsiz++;
  }
  kontrol("aynı girdi → aynı kategori dilimi", kararsiz === 0, "200 sayfa × 2 çağrı");

  // Hiçbir kural, sayfanın kendi başlığını içeren bir kategori döndürmemeli.
  let basligiSizdiran = 0;
  for (const p of pages) {
    for (const kural of ["uye6", "enBuyuk", "uye2"] as const) {
      const v = kategoriDilimi(p, uyeSayilari, kural);
      if (v === DIGER) continue;
      const k = v.replace(/^Category:/, "").toLocaleLowerCase("en");
      if (p.title.length >= 4 && k.includes(p.title.toLocaleLowerCase("en"))) basligiSizdiran++;
    }
  }
  kontrol(
    "hiçbir kategori dilimi sayfanın başlığını içermiyor",
    basligiSizdiran === 0,
    `${pages.length} sayfa × 3 kural`
  );

  console.log(`\n=== 3) Panel: tohumlu dilim dağıtımı (SPEC §6) ===`);

  const ctx: DilimBaglami = { esikler, uyeSayilari, kategoriKurali: "uye2" };

  const p1 = hakemPaneliKur(42, 4);
  const p2 = hakemPaneliKur(42, 4);
  kontrol(
    "aynı tohum + aynı büyüklük → aynı atama",
    JSON.stringify(p1.hakemler) === JSON.stringify(p2.hakemler),
    p1.hakemler.map((h) => `${h.id}:${h.dilimTuru}`).join(" ")
  );

  const p3 = hakemPaneliKur(43, 4);
  kontrol(
    "farklı tohum → (genelde) farklı atama",
    JSON.stringify(p1.hakemler) !== JSON.stringify(p3.hakemler),
    p3.hakemler.map((h) => `${h.id}:${h.dilimTuru}`).join(" ")
  );

  kontrol("sistem hakemi her zaman var ve tek", p1.hakemler.filter((h) => h.tur === "sistem").length === 1);
  kontrol("sistem hakemi 1 dilim alır", p1.sistemHakemi.dilimTuru !== undefined, p1.sistemHakemi.dilimTuru);

  // Panel 2–5: dilim türleri TEKRARSIZ olmalı.
  let tekrar = 0;
  for (let n = MIN_PANEL; n <= 5; n++) {
    for (let seed = 0; seed < 50; seed++) {
      const panel = hakemPaneliKur(seed, n);
      const turler = panel.hakemler.map((h) => h.dilimTuru);
      if (new Set(turler).size !== turler.length) tekrar++;
      if (panel.dagitilmayanDilimler.length !== TUM_DILIM_TURLERI.length - n) tekrar++;
    }
  }
  kontrol(
    "panel ≤5: her hakem farklı dilim, kalanlar dağıtılmamış",
    tekrar === 0,
    "n=2..5 × 50 tohum"
  );

  // Panel 6–10: SPEC boşluğu — dilim türleri tekrar eder (bkz. hakemPaneliKur notu).
  let altiArtiHata = 0;
  for (let n = 6; n <= MAX_PANEL; n++) {
    const panel = hakemPaneliKur(7, n);
    if (panel.hakemler.length !== n) altiArtiHata++;
    if (panel.dagitilmayanDilimler.length !== 0) altiArtiHata++;
    if (new Set(panel.hakemler.map((h) => h.dilimTuru)).size !== TUM_DILIM_TURLERI.length) {
      altiArtiHata++;
    }
  }
  kontrol(
    "panel 6–10: tüm 5 dilim dağıtılır, türler tekrar eder (SPEC boşluğu, bildirildi)",
    altiArtiHata === 0
  );

  for (const gecersiz of [0, 1, 11, 2.5]) {
    let hataAtti = false;
    try {
      hakemPaneliKur(1, gecersiz);
    } catch {
      hataAtti = true;
    }
    kontrol(`geçersiz panel büyüklüğü reddedildi (${gecersiz})`, hataAtti);
  }

  console.log(`\n=== 4) dilimUret: tüm türler üretilebiliyor, tutarlı ===`);

  const state: MatchState = {
    seed: 1,
    turn: 4,
    turnLimit: 30,
    kacakPosition: world.titles[10],
    avciPosition: world.titles[500],
    kacakSpecializations: [],
    avciSpecializations: [],
    kacakStayStreak: 3,
    kacakMoveCount: 1,
    kacakStayCount: 3,
    status: "devam",
    log: [],
  };

  for (const tur of TUM_DILIM_TURLERI) {
    const d = dilimUret(world, state, tur, ctx);
    kontrol(`dilimUret(${tur}) boş değil`, d.deger.length > 0, d.deger);
  }

  // Üretilen dilim, kendi filtresinden geçen küme İÇİNDE gerçek sayfayı barındırmalı.
  let tutarsiz = 0;
  for (const tur of TUM_DILIM_TURLERI) {
    const d = dilimUret(world, state, tur, ctx);
    if (d.deger === "bilinmiyor") continue;
    const uyanlar = dilimeUyanSayfalar(world, pages, d, { ...ctx, avciPos: state.avciPosition });
    if (!uyanlar.some((p) => p.title === state.kacakPosition)) tutarsiz++;
  }
  kontrol("her dilim değeri gerçek sayfayı aday kümesinde bırakıyor", tutarsiz === 0);

  console.log(`\n=== SONUÇ ===`);
  console.log(failures === 0 ? "✓ Tüm dilim/panel testleri geçti." : `✗ ${failures} test BAŞARISIZ.`);
  if (failures > 0) process.exit(1);
}

main();
