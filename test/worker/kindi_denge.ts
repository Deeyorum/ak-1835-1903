import * as path from "path";
import { loadWorldFromFile } from "../loadWorldFile";
import { setupMatch, DEFAULT_TURN_LIMIT } from "../../src/game/setup";
import { processTurn } from "../../src/game/engine";
import { kacakView, avciView } from "../../src/game/views";
import { createOlayToplayici } from "../../src/game/hakemSuzgec";
import { createRng } from "../../src/game/rng";
import type { MatchState } from "../../src/game/types";
import { kindiHamlesi } from "../../src/worker/platformBotlari";
import { macIcinHakemKanaliOlustur, macPaneliniKur } from "../../src/worker/hakemleri";
import { stayKacak, wanderingKacak, type KacakBotFn } from "../bots/kacakBots";

/**
 * G4B-1 / G4B-1b (Madde 3) — Kindi vs referans Kaçak, DENGE ÖLÇÜMÜ
 * (G2B/G3 metodolojisi: 300 tohum, kazanma%/ortalama tur — bkz.
 * test/balance.ts, test/hakem_olcum.ts).
 *
 * G4B-1b'de referans Kaçak, `platformKacakHamlesi` (basit, %20 kal)
 * YERİNE goal'ün istediği G3 referanslarıyla (`stayKacak`/
 * `wanderingKacak`, test/bots/kacakBots.ts — hakem_olcum.ts'in de
 * kullandığı AYNI botlar) DOĞRUDAN KARŞILAŞTIRILABİLİR hâle getirildi
 * — bkz. DEFTER.md "G4B-1b" Madde 3 karşılaştırma tablosu.
 *
 * G2B'nin kendi script'i (`test/balance.ts`) `createStubHakemKanali`
 * kullanıyordu (HER soruya "Bu konuda bilgi veremem." — Kindi'nin
 * dilim-ayrıştırma stratejisi bu stub'la işe yaramaz hâle gelirdi).
 * Bu script bunun yerine G4A'nın GERÇEK hakem panelini (`hakemleri.ts`)
 * kullanır — Kindi'nin production'da GÖRECEĞİ tam hakem davranışı.
 *
 * DENGE BU SONUCA GÖRE AYARLANMAZ (DURUM.md madde d) — yalnız ÖLÇÜLÜR
 * ve raporlanır.
 */

const WORLD_FILE = path.join(__dirname, "../../world/world.scc.json");
const N_SEEDS = 300;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

interface MacSonucu {
  status: MatchState["status"];
  turnsPlayed: number;
}

function macOynat(
  world: ReturnType<typeof loadWorldFromFile>,
  seed: number,
  kacakBot: KacakBotFn
): MacSonucu {
  let state = setupMatch(world, {
    seed,
    kacakSpecializations: [],
    avciSpecializations: [],
    turnLimit: DEFAULT_TURN_LIMIT,
  });
  const panel = macPaneliniKur(seed);
  const toplayici = createOlayToplayici();
  const hakemKanali = macIcinHakemKanaliOlustur(panel, () => state, toplayici, {
    // SEED-C: bu denge ölçümü Kindi'nin kazanma oranını ölçüyor,
    // etiketin kendisini değil — sabit yer tutucu.
    turEtiketi: "DENGEETIKETI",
  });
  const botRng = createRng(seed);

  const GUVENLIK = state.turnLimit + 10;
  let dongu = 0;
  while (state.status === "devam" && dongu < GUVENLIK) {
    const kacakMove = kacakBot(kacakView(world, state), botRng);
    const kindiKarar = kindiHamlesi(seed, state.turn, avciView(world, state));
    const sonuc = processTurn(world, state, kacakMove, kindiKarar.move, hakemKanali, {
      avciHakemMesajlari: kindiKarar.hakemMesajlari,
      olayToplayici: toplayici,
    });
    state = sonuc.state;
    dongu++;
  }

  return { status: state.status, turnsPlayed: state.turn - 1 };
}

function olc(world: ReturnType<typeof loadWorldFromFile>, ad: string, bot: KacakBotFn) {
  let avciKazandi = 0;
  const turlar: number[] = [];
  for (let seed = 0; seed < N_SEEDS; seed++) {
    const sonuc = macOynat(world, seed, bot);
    if (sonuc.status === "avciKazandi") avciKazandi++;
    turlar.push(sonuc.turnsPlayed);
  }
  const winRate = (100 * avciKazandi) / N_SEEDS;
  console.log(
    `Avcı (Kindi) kazanma vs ${ad.padEnd(16)}: %${winRate.toFixed(1).padStart(5)} (${avciKazandi}/${N_SEEDS})  OrtTur=${mean(turlar).toFixed(1)}`
  );
  return winRate;
}

function main() {
  console.log(`Dünya yükleniyor: ${WORLD_FILE}`);
  const world = loadWorldFromFile(WORLD_FILE);
  console.log(`${world.titles.length} sayfa (SCC) yüklendi. ${N_SEEDS} tohum.\n`);

  console.log(`=== Kindi (üretim, G4B-1b Madde 3) vs referans Kaçak — ${N_SEEDS} tohum ===\n`);
  const kalKazanma = olc(world, "kal (stayKacak)", stayKacak);
  const gezenKazanma = olc(world, "rastgeleGezen", wanderingKacak);

  /**
   * ±5 puan sapma kontrolü. Referans: G3 enBuyuk N=3 K=1 —
   *  - ESKİ (DURUM.md madde d, bolge süzmesi düzeltmesi ÖNCESİ):
   *    kal ~%44, gezen ~%9;
   *  - bolge düzeltmesiyle yeniden ölçülen (DEFTER.md "G4B-1b" Madde 2):
   *    kal %49.0, gezen %10.0;
   *  - G4B-1b'nin KAPANIŞ ölçümü (eşik kaldırıldıktan sonraki üretim
   *    Kindi'si): kal %51.0, gezen %7.0;
   *  - **G4B-2a — GÜNCEL TABAN (DeeOne kararı):** kal %58.7,
   *    gezen %6.3. Madde 2'nin daraltılmış "taze bilgi" tanımı + döngü
   *    korumasının KONUM KOŞULU (bkz. platformBotlari.ts) sonrası.
   *    G4B-1b'ye göre kal +7.7 puan: ±5 kapısı AŞILDI, DUR verildi ve
   *    DeeOne sapmayı KABUL etti — kök neden korumadaki bir YANLIŞ
   *    POZİTİFin düzeltilmesi (Kindi yeni bir sayfaya taşındığında bile
   *    yakalaması engelleniyordu), dengeye göre ayarlama DEĞİL
   *    (DURUM.md madde d). Ayrıntı: DEFTER.md "G4B-2a".
   * Her referansa karşı KONTROL EDİLİR; biri ±5 puan içindeyse sapma
   * YOK sayılır.
   */
  const referanslar = {
    kal: [44, 49.0, 51.0, 58.7],
    gezen: [9, 10.0, 7.0, 6.3],
  };
  function sapmaKontrol(ad: string, olculen: number, refler: number[]) {
    const enYakinSapma = Math.min(...refler.map((r) => Math.abs(olculen - r)));
    const tamam = enYakinSapma <= 5;
    console.log(
      `${tamam ? "✓" : "✗ DUR"} ${ad}: ölçülen=%${olculen.toFixed(1)} referanslar=${refler.map((r) => `%${r}`).join("/")} en yakın sapma=${enYakinSapma.toFixed(1)} puan`
    );
    return tamam;
  }
  console.log(`\n=== ±5 puan sapma kontrolü ===`);
  const kalTamam = sapmaKontrol("kal", kalKazanma, referanslar.kal);
  const gezenTamam = sapmaKontrol("gezen", gezenKazanma, referanslar.gezen);
  if (!kalTamam || !gezenTamam) {
    console.log(`\n✗ DUR: ölçülen kazanma oranı referanslardan ±5 puandan fazla sapıyor.`);
    process.exit(1);
  }

  console.log(`\nDenge bu sonuca göre AYARLANMADI (DURUM.md madde d) — yalnız ölçüldü.`);
}

main();
