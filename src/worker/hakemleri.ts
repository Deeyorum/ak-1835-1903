import { getWorld } from "./dunya";
import type { MatchState, Specialization } from "../game/types";
import {
  dereceEsikleriHesapla,
  kategoriUyeSayilari,
  type DilimBaglami,
} from "../game/hakemDilim";
import { hakemPaneliKur, type HakemPaneli } from "../game/hakemPanel";
import { modelGirdisiKur, uyumluModel, type HakemModeli } from "../game/hakemModel";
import {
  createBellekKullaniciKanali,
  createPanelKanali,
  type KullaniciHakemMesaji,
  type PanelKanali,
} from "../game/hakemKanali";
import type { OlayToplayici } from "../game/hakemSuzgec";

/**
 * G4A: DeeOne kararı — "kategori kuralı enBuyuk; v0.1 panel sabit 3
 * platform hakemi". Gerçek Workers AI adaptörü G4B'de gelir; burada
 * TÜM panel (sistem + 2 "kullanıcı" hakemi, G3'ün hakemPaneliKur'unun
 * ürettiği tek-sistem-N-1-kullanıcı dağılımı) AYNI sahte (uyumlu)
 * modeli kullanır — G4A'da gerçek kullanıcı hakemi kanalı yok, üçü de
 * platform tarafından simüle ediliyor.
 */
export const HAKEM_PANEL_BUYUKLUGU = 3;
export const KATEGORI_KURALI = "enBuyuk" as const;

const world = getWorld();
const dilimBaglami: DilimBaglami = {
  esikler: dereceEsikleriHesapla(world),
  uyeSayilari: kategoriUyeSayilari(Array.from(world.pages.values())),
  kategoriKurali: KATEGORI_KURALI,
};

export function dilimBaglaminiGetir(): DilimBaglami {
  return dilimBaglami;
}

/**
 * Motorun kendi hakem-mesajı kotası (bkz. `src/game/engine.ts`
 * `BASE_HAKEM_KOTASI` + Arabulucu +1 — Madde 0 doğrulamasıyla teyit
 * edildi). ENGINE'DEN DIŞA AKTARILMAZ (src/game'e Madde 2 dışında
 * dokunmama kuralı, G4B-1b goal'ü) — bu yüzden formül burada, Worker
 * katmanında, TEK bir yerde YİNELENİR (maclar.ts VE platformBotlari.ts
 * aynı sabiti kullanır, ayrı ayrı kopyalamaz). BİLİNEN RİSK: engine.ts
 * değişirse bu kopyanın fark edilmeden ESKİ KALMASI — bkz. DEFTER.md
 * "G4B-1b", ÖNERİ olarak işaretlendi.
 */
export const HAKEM_MESAJ_TABAN_KOTASI = 1;

export function avciHakemKotasi(avciSpecializations: readonly Specialization[]): number {
  return HAKEM_MESAJ_TABAN_KOTASI + (avciSpecializations.includes("arabulucu") ? 1 : 0);
}

export function macPaneliniKur(seed: number): HakemPaneli {
  return hakemPaneliKur(seed, HAKEM_PANEL_BUYUKLUGU);
}

/**
 * G4B-2a Madde 1 — model enjeksiyonu. VERİLMEZSE G4A/G4B-1 davranışı
 * (sahte `uyumluModel`, ağsız) AYNEN korunur; `HAKEM_MODU="workersAi"`
 * olduğunda `hakemKopru.ts` buraya önceden hesaplanmış (gerçek modelden
 * gelmiş) SENKRON modelleri geçirir.
 *
 * `turEtiketi` SEED-C ile ZORUNLU oldu (fail closed, varsayılan YOK) —
 * bkz. `src/game/hakemKanali.ts` `turEtiketiUret` notu. ÇAĞIRAN
 * (`maclar.ts`) bunu turun başında `await turEtiketiUret(seed, turn,
 * env.ETIKET_SIRRI)` ile BİR KEZ hesaplar ve buraya düz bir dizge
 * olarak geçirir.
 */
export interface HakemKanaliSecenekleri {
  sistemModeli?: HakemModeli;
  kullaniciOtoYanit?: (m: KullaniciHakemMesaji) => string | undefined;
  turEtiketi: string;
}

/**
 * Bu maç için bir HakemKanali kurar. Sistem hakemi VE "kullanıcı"
 * hakemleri (G4A'da hepsi platform tarafından simüle edildiği için)
 * aynı uyumlu sahte modeli kullanır — her biri YALNIZ kendi dilimini
 * söyler (bkz. src/game/hakemModel.ts, modelGirdisiKur imzası
 * MatchState/WorldData ALMAZ, bağlam yalıtımı tip düzeyinde).
 */
export function macIcinHakemKanaliOlustur(
  panel: HakemPaneli,
  getState: () => MatchState,
  olayToplayici: OlayToplayici | undefined,
  secenekler: HakemKanaliSecenekleri
): PanelKanali {
  // No-implicit-undefined: her iki alan da açıkça çözülür, zincirleme
  // erişimle örtülü `undefined` yayılmaz.
  const sistemModeli = secenekler.sistemModeli ?? uyumluModel;
  const otoYanit =
    secenekler.kullaniciOtoYanit ??
    ((m: KullaniciHakemMesaji) =>
      uyumluModel(modelGirdisiKur(m.dilim, [{ gonderen: m.gonderen, metin: m.metin }])));

  return createPanelKanali({
    world,
    getState,
    panel,
    dilimBaglami,
    sistemModeli,
    kullaniciKanali: createBellekKullaniciKanali({ otoYanit }),
    olayYaz: olayToplayici?.yaz,
    turEtiketi: secenekler.turEtiketi,
  });
}
