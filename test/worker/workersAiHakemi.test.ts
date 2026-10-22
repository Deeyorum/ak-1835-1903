import {
  workersAiModeliCagir,
  yanitMetniniCikar,
  MODEL_HATASI_SABIT_YANITI,
  type EnvAiRunlayici,
} from "../../src/worker/workersAiHakemi";
import { modelGirdisiKur } from "../../src/game/hakemModel";
import { suz } from "../../src/game/hakemSuzgec";
import type { Dilim } from "../../src/game/hakemDilim";

/**
 * G4B-1 — Workers AI adaptörü birim sınaması.
 *
 * GERÇEK env.AI ÇAĞRISI YOK. `EnvAiRunlayici` arayüzünü uygulayan sahte
 * AI'lar kullanılır — adaptörün KENDİ mantığını (yanıt ayrıştırma,
 * hata/zaman aşımı/süzgeç-reddinde sabit yanıt) sınar.
 */

let failures = 0;
function kontrol(ad: string, kosul: boolean, detay = ""): void {
  console.log(`${kosul ? "✓" : "✗"} ${ad}${detay === "" ? "" : ` — ${detay}`}`);
  if (!kosul) failures++;
}

const DILIM: Dilim = { tur: "harf", deger: "G" };

function sahteGirdi() {
  return modelGirdisiKur(DILIM, [{ gonderen: "avci", metin: "What do you know?" }]);
}

async function main() {
  console.log(`=== G4B-1: Workers AI adaptörü birim sınaması ===\n`);

  // --- yanitMetniniCikar() doğrudan ---
  kontrol("düz string tanınır", yanitMetniniCikar("merhaba") === "merhaba");
  kontrol("{response} alanı tanınır", yanitMetniniCikar({ response: "x" }) === "x");
  kontrol("{result} alanı tanınır", yanitMetniniCikar({ result: "y" }) === "y");
  kontrol("tanınmayan biçim (sayı) undefined", yanitMetniniCikar(42) === undefined);
  kontrol("tanınmayan biçim (boş nesne) undefined", yanitMetniniCikar({}) === undefined);
  kontrol("null undefined döner", yanitMetniniCikar(null) === undefined);

  // --- 1) Başarılı çağrı ---
  const basariliAi: EnvAiRunlayici = {
    run: async () => ({ response: "As far as I know, the harf is G." }),
  };
  const basariliYanit = await workersAiModeliCagir(
    { ai: basariliAi, modelAdi: "@cf/test/model" },
    sahteGirdi()
  );
  kontrol(
    "başarılı çağrı modelin metnini döner",
    basariliYanit === "As far as I know, the harf is G.",
    basariliYanit
  );

  // --- 2) HATA durumu ---
  const hataVerenAi: EnvAiRunlayici = {
    run: async () => {
      throw new Error("ağ hatası (içeriği asla sızdırılmamalı)");
    },
  };
  const hataYaniti = await workersAiModeliCagir(
    { ai: hataVerenAi, modelAdi: "@cf/test/model" },
    sahteGirdi()
  );
  kontrol(
    "hata durumunda sabit yanıt döner",
    hataYaniti === MODEL_HATASI_SABIT_YANITI,
    hataYaniti
  );
  kontrol(
    "hata mesajının içeriği sızmıyor",
    !hataYaniti.includes("ağ hatası"),
    hataYaniti
  );

  // --- 3) ZAMAN AŞIMI durumu ---
  const asiriYavasAi: EnvAiRunlayici = {
    run: () => new Promise(() => {}), // asla çözümlenmez
  };
  const zamanAsimiYaniti = await workersAiModeliCagir(
    { ai: asiriYavasAi, modelAdi: "@cf/test/model", zamanAsimiMs: 30 },
    sahteGirdi()
  );
  kontrol(
    "zaman aşımında sabit yanıt döner",
    zamanAsimiYaniti === MODEL_HATASI_SABIT_YANITI,
    zamanAsimiYaniti
  );

  // --- Boş/şekilsiz yanıt da hata gibi ele alınır ---
  const sekilsizAi: EnvAiRunlayici = { run: async () => ({ beklenmeyenAlan: 123 }) };
  const sekilsizYanit = await workersAiModeliCagir(
    { ai: sekilsizAi, modelAdi: "@cf/test/model" },
    sahteGirdi()
  );
  kontrol(
    "şekilsiz yanıtta sabit yanıt döner",
    sekilsizYanit === MODEL_HATASI_SABIT_YANITI,
    sekilsizYanit
  );

  const bosYanitAi: EnvAiRunlayici = { run: async () => ({ response: "   " }) };
  const bosYanit = await workersAiModeliCagir(
    { ai: bosYanitAi, modelAdi: "@cf/test/model" },
    sahteGirdi()
  );
  kontrol(
    "yalnız boşluk içeren yanıtta sabit yanıt döner",
    bosYanit === MODEL_HATASI_SABIT_YANITI,
    JSON.stringify(bosYanit)
  );

  // --- 4) SÜZGEÇ REDDİ: adaptör SÜZMEZ, ama döndürdüğü metin var olan
  // (G3'te 123.785 denemeyle sertleştirilmiş) süzgeçten geçtiğinde
  // yakalanmaya devam eder. ---
  const sizdiranAi: EnvAiRunlayici = {
    run: async () => ({ response: "The fugitive's exact page is Gesta Regum Anglorum." }),
  };
  const sizdiranYanit = await workersAiModeliCagir(
    { ai: sizdiranAi, modelAdi: "@cf/test/model" },
    sahteGirdi()
  );
  kontrol(
    "adaptör KENDİSİ süzme yapmaz (ham metni döner)",
    sizdiranYanit.includes("Gesta Regum Anglorum"),
    sizdiranYanit
  );
  const suzgecSonucu = suz(sizdiranYanit, {
    gercekBaslik: "Gesta Regum Anglorum",
    izinliDeger: DILIM.deger,
  });
  kontrol(
    "ama downstream süzgeç (hakemSuzgec.ts) bu sızıntıyı YAKALAR",
    suzgecSonucu.engellendi && suzgecSonucu.metin === MODEL_HATASI_SABIT_YANITI,
    JSON.stringify(suzgecSonucu)
  );

  console.log(`\n=== SONUÇ ===`);
  console.log(failures === 0 ? "✓ Tüm AI adaptörü testleri geçti." : `✗ ${failures} test BAŞARISIZ.`);
  if (failures > 0) process.exit(1);
}

main();
