import { suz } from "../../src/game/hakemSuzgec";

/**
 * G4B-2b — "orta" ÇAKIŞMASININ doğrulaması (model çağrısı YOK, saf hesap).
 *
 * NEDEN VAR: G4B-2b'nin 10 maçlık fazında bağımsız denetçi TEK bir
 * "süzgeç sonrası yasak değer" bulgusu verdi (seed 2002, tur 21): sistem
 * hakeminin dilimi `derece`, yanıtı `...has an "orta" in it`, ve o turda
 * `bolge` dilimi de "orta"ydı. Denetçi bunu "başka hakemin dilim değeri
 * sızdı" diye işaretledi.
 *
 * BULGU SIZINTI DEĞİL, ÇAKIŞMADIR: `derece` değer uzayı
 * {düşük, orta, yüksek}, `bolge` değer uzayı {yakın, orta, uzak} — ikisi
 * "orta"da örtüşür. Hakem kendi değerini söylediğinde, o dizge aynı anda
 * başka bir dilimin değeri olabilir. Üretim süzgeci bu durumu ZATEN
 * biliyor (`hakemSuzgec.ts`, `yasakliSirlar`: `izinliDusur && n === izinli`
 * — G4B-3a'dan beri YALNIZ `digerDilim` değerleri için) ve hakemin meşru
 * yanıtını kendi süzgecine kurban etmiyor.
 *
 * Bu dosya o davranışı İKİ YÖNLÜ sabitler: aynı metin, yalnız
 * `izinliDeger` değişerek, bir kez GEÇER bir kez ENGELLENİR. Böylece
 * ölçümdeki tek bulgunun gerekçesi argümanla değil, çalıştırılabilir bir
 * kontrolle kayda geçer. Süzgeç DEĞİŞTİRİLMEDİ — bu yalnız gözlem.
 */

let hata = 0;
function kontrol(ad: string, kosul: boolean, detay = ""): void {
  console.log(`${kosul ? "✓" : "✗"} ${ad}${detay === "" ? "" : ` — ${detay}`}`);
  if (!kosul) hata++;
}

const METIN = 'I know that the fugitive\'s page has an "orta" in it.';
/** Kısa değerler (`harf`="Z", `hareket`="0") bağlamda KALIR: süzgecin
 *  KISA_DEGER_ESIGI politikası bu kontrolün konusu değil. */
const DIGER = ["orta", "0", "Z"];

const kendiDegeri = suz(METIN, {
  gercekBaslik: "Zeus",
  sayfaKimligi: 123,
  izinliDeger: "orta",
  digerDilimDegerleri: DIGER,
});

const baskasininDegeri = suz(METIN, {
  gercekBaslik: "Zeus",
  sayfaKimligi: 123,
  izinliDeger: "yüksek",
  digerDilimDegerleri: DIGER,
});

kontrol(
  'hakemin KENDİ değeri "orta" ⇒ yanıt GEÇER (meşru, kurban edilmez)',
  kendiDegeri.engellendi === false,
  `engellendi=${kendiDegeri.engellendi}`
);
kontrol(
  'aynı metin, kendi değeri "yüksek" ⇒ "orta" BAŞKA hakemin değeri, ENGELLENİR',
  baskasininDegeri.engellendi === true && baskasininDegeri.sebep === "digerDilim",
  `engellendi=${baskasininDegeri.engellendi} sebep=${baskasininDegeri.sebep ?? "-"}`
);

/**
 * G4B-3a — G4B-2b Bulgu 3 DÜZELTİLDİ; bu kontrol artık İSTENEN davranışı
 * sabitler (önceki hâli mevcut kusuru "⚠ KUSUR" diye sabitliyordu).
 *
 * Kusur: `ekle()` içindeki `n === izinli` elemesi TÜM değerlere, başlık
 * ve sayfa kimliğine DE uygulanıyordu — hakemin kendi dilim değeri
 * başlıkla aynı dizgeye inerse GERÇEK BAŞLIK yasak listesine HİÇ
 * eklenmiyor, son `filter(...)` adımının muafiyetine GELMEDEN düşüyordu.
 * ULAŞILABİLİR: başlığı `"0"` olan sayfa + `harf`/`hareket` dilimi "0".
 *
 * Düzeltme: eleme `izinliDusur` seçeneğiyle YALNIZ `digerDilim` sebepli
 * değerlere uygulanır (yukarıdaki birinci/ikinci kontrol bu yüzden
 * DEĞİŞMEDEN geçer). Bedel bilinçlidir: o sayfada hakemin KENDİ meşru
 * "0" yanıtı da kesilir — o dizge aynı anda tam konumun kendisi olduğu
 * için fail-closed tercih edilir.
 */
const baslikKorunurCakismada = suz("The answer is 0.", {
  gercekBaslik: "0",
  sayfaKimligi: 999,
  izinliDeger: "0",
  digerDilimDegerleri: [],
});
kontrol(
  "G4B-3a: izinliDeger başlıkla aynı olsa da GERÇEK BAŞLIK ENGELLENİR",
  baslikKorunurCakismada.engellendi === true && baslikKorunurCakismada.sebep === "baslik",
  `engellendi=${baslikKorunurCakismada.engellendi} sebep=${baslikKorunurCakismada.sebep ?? "-"} — belgelenen "her koşulda korunur" iddiasıyla ARTIK UYUMLU`
);

/** Kontrol grubu: kendi değeri FARKLIysa başlık beklendiği gibi korunur. */
const baslikKorunur = suz("The page is Zeus.", {
  gercekBaslik: "Zeus",
  sayfaKimligi: 123,
  izinliDeger: "orta",
  digerDilimDegerleri: [],
});
kontrol(
  "kendi değeri farklıysa GERÇEK BAŞLIK engellenir (kontrol grubu)",
  baslikKorunur.engellendi === true && baslikKorunur.sebep === "baslik",
  `engellendi=${baslikKorunur.engellendi} sebep=${baslikKorunur.sebep ?? "-"}`
);

if (hata > 0) {
  console.log(`\n✗ ${hata} kontrol BAŞARISIZ.`);
  process.exit(1);
}
console.log("\n✓ Çakışma doğrulaması geçti: tek ölçüm bulgusu sızıntı DEĞİL, çakışmadır.");
