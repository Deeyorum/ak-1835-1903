import { createRng } from "./rng";
import { TUM_DILIM_TURLERI, type DilimTuru } from "./hakemDilim";

/**
 * G3 Madde 2 — DİLİM DAĞITIMI (SPEC §6).
 *
 * Sistem hakemi 1 dilim alır; kalan dilimler kullanıcı hakemlerine
 * dağıtılır. Tür ataması maç kurulumunda tohumludur (aynı tohum +
 * aynı panel büyüklüğü → aynı atama).
 */

export const MIN_PANEL = 2;
export const MAX_PANEL = 10;

export type HakemTuru = "sistem" | "kullanici";

export interface HakemAtamasi {
  id: string;
  tur: HakemTuru;
  /** Bu hakemin bildiği TEK dilim türü. */
  dilimTuru: DilimTuru;
}

export interface HakemPaneli {
  hakemler: readonly HakemAtamasi[];
  sistemHakemi: HakemAtamasi;
  /** Hiçbir hakeme verilmemiş dilim türleri (SPEC §6: "az hakem varsa
   * bazı dilimler kimseye verilmez"). */
  dagitilmayanDilimler: readonly DilimTuru[];
}

/**
 * Tohumlu panel kurulumu.
 *
 * **SPEC BOŞLUĞU (G3'te bildirildi):** SPEC §6 panel büyüklüğünü 2–10
 * olarak verir ama yalnız 5 dilim türü tanımlar. 6+ hakemli panelde ne
 * olacağı yazılmamıştır. İki seçenek vardı: (i) fazla hakemlere dilim
 * verilmez (hiçbir şey bilmeyen tuzak hakemler), (ii) dilim türleri
 * tekrar eder (iki hakem aynı türü bilir). **(ii) seçildi**, çünkü §6
 * "Her hakem Kaçak'ın konumuna dair yalnız kendi bilgi dilimini bilir"
 * diyerek her hakemin BİR dilimi olduğunu varsayar. Sonucu: 6+ hakemli
 * panelde Avcı aynı dilimi iki kaynaktan doğrulayabilir (yeni bilgi
 * kazanmaz, yalan söyleyen hakeme karşı çapraz kontrol kazanır).
 * SPEC'e işlenmesi DeeOne'a bırakıldı.
 */
export function hakemPaneliKur(seed: number, hakemSayisi: number): HakemPaneli {
  if (!Number.isInteger(hakemSayisi)) {
    throw new Error(`Panel büyüklüğü tam sayı olmalı, ${hakemSayisi} verildi.`);
  }
  if (hakemSayisi < MIN_PANEL || hakemSayisi > MAX_PANEL) {
    throw new Error(
      `Panel büyüklüğü ${MIN_PANEL}–${MAX_PANEL} aralığında olmalı, ${hakemSayisi} verildi.`
    );
  }

  // Tohumlu karıştırma (Fisher-Yates) — dilim türü sırası maça özgüdür.
  const rng = createRng(seed);
  const karisik: DilimTuru[] = [...TUM_DILIM_TURLERI];
  for (let i = karisik.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = karisik[i];
    karisik[i] = karisik[j];
    karisik[j] = tmp;
  }

  const hakemler: HakemAtamasi[] = [];
  for (let i = 0; i < hakemSayisi; i++) {
    const dilimTuru = karisik[i % karisik.length];
    hakemler.push(
      Object.freeze({
        id: i === 0 ? "sistem" : `kullanici-${i}`,
        tur: i === 0 ? "sistem" : "kullanici",
        dilimTuru,
      })
    );
  }

  const verilen = new Set(hakemler.map((h) => h.dilimTuru));
  const dagitilmayanDilimler = TUM_DILIM_TURLERI.filter((t) => !verilen.has(t));

  return Object.freeze({
    hakemler: Object.freeze(hakemler),
    sistemHakemi: hakemler[0],
    dagitilmayanDilimler: Object.freeze(dagitilmayanDilimler),
  });
}

export function hakemBul(panel: HakemPaneli, hakemId: string): HakemAtamasi | undefined {
  return panel.hakemler.find((h) => h.id === hakemId);
}
