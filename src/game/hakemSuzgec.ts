import type { PageTitle, SuzgecOlayi } from "./types";

/**
 * G3 Madde 4 — ÇIKIŞ SÜZGECİ.
 *
 * Tasarım ilkesi: **güvenlik modele değil koda dayanır.** Sistem hakemi
 * küçük bir modeldir ve manipüle edilebilir; bu süzgeç modelin ne kadar
 * iyi talimat izlediğine HİÇ güvenmez. Modelin ürettiği metin, hakemin
 * kendi dilim değeri dışındaki bir gizli değeri (gerçek başlık, sayfa
 * kimliği, başka hakemlerin dilim değerleri) taşıyorsa metin tamamen
 * atılır ve yerine sabit red yanıtı konur.
 *
 * Fail-closed: şüphe varsa engelle. Yanlış pozitif maliyeti bir hakem
 * yanıtının kaybı; yanlış negatif maliyeti maçın bozulmasıdır.
 *
 * Yakalama iki yönden birlikte yapılır (G3'te ölçülerek bu hâle geldi):
 *   1. **Parmak izi:** sırrın her kodlamadaki hâli (düz, ters, base64,
 *      hex, rot13, ondalık) önceden üretilir ve metinde aranır. Kısa
 *      sırlarda kesindir — çözmeye çalışmadığı için çöp üretmez.
 *   2. **Kod çözme:** metindeki base64/hex/ondalık görünümlü koşular
 *      çözülüp yeniden aranır. Bu, sırrın KODLANMIŞ BİR CÜMLENİN İÇİNDE
 *      geçtiği durumu yakalar (parmak izi tek başına kaçırır).
 */

export const SABIT_RED_YANITI = "Bu konuda bilgi veremem.";

/**
 * Bu uzunluğun altındaki **başka-hakem dilim değerleri** aranmaz.
 *
 * Neden (G3'te ölçüldü): `harf` dilimi tek karakterdir ve İngilizce
 * zamir "I" ile BİREBİR çakışır — başlığı I ile başlayan bir sayfada
 * "I cannot help with that." gibi tamamen zararsız her yanıt
 * engellenirdi (ölçüm: 480 zararsız yanıtta 29 yanlış pozitif).
 * `hareket` dilimi de tek basamaklı olabilir ("0").
 *
 * Bu değerler için ilk savunma hattı zaten YAPISALDIR: başka hakemin
 * dilimi bu hakemin bağlamına hiç girmez (bkz. hakemModel.
 * modelGirdisiKur). Süzgeç burada ikinci hattır ve tek karakterlik bir
 * değerde uygulanabilir değildir. SPEC §6'nın v0.2 canary izleri bu
 * boşluğu kapatmak için vardır.
 *
 * NOT: gerçek başlık ve sayfa kimliği bu istisnaya GİRMEZ — onlar kısa
 * olsalar bile tam sözcük eşleşmesiyle aranır (dünyada tek karakterli
 * bir başlık mevcut: "0").
 */
export const KISA_DEGER_ESIGI = 3;

export type SuzgecVaryanti = SuzgecOlayi["varyant"];
export type SuzgecSebebi = SuzgecOlayi["sebep"];

export interface SuzgecBaglami {
  /** Kaçak'ın gerçek sayfa başlığı — asla sızmamalı. */
  gercekBaslik: PageTitle;
  /** Gerçek sayfanın kimliği (world.scc.json pageId). */
  sayfaKimligi?: number | string;
  /** Bu hakemin KENDİ dilim değeri — söylemesi meşrudur. */
  izinliDeger: string;
  /** Başka hakemlerin dilim değerleri — bu hakem bunları bilmiyor olmalı. */
  digerDilimDegerleri?: readonly string[];
}

export interface SuzgecSonucu {
  /** Çağırana verilecek metin (engellendiyse SABIT_RED_YANITI). */
  metin: string;
  engellendi: boolean;
  sebep?: SuzgecSebebi;
  varyant?: SuzgecVaryanti;
}

/**
 * Süzgeç olaylarını toplayıp maç kaydına aktarmak için küçük bir
 * biriktirici. Kanal yazar, motor her tur sonunda boşaltıp o turun
 * kayıt girdisine ekler.
 */
export interface OlayToplayici {
  yaz(olay: SuzgecOlayi): void;
  /** Biriken olayları döner ve biriktiriciyi sıfırlar. */
  bosalt(): SuzgecOlayi[];
}

export function createOlayToplayici(): OlayToplayici {
  let olaylar: SuzgecOlayi[] = [];
  return {
    yaz(olay: SuzgecOlayi): void {
      olaylar.push(olay);
    },
    bosalt(): SuzgecOlayi[] {
      const sonuc = olaylar;
      olaylar = [];
      return sonuc;
    },
  };
}

// ------------------------------------------------------ normalleştirme

/**
 * Aksan katlar, küçük harfe indirir, harf/rakam dışındaki HER ŞEYİ atar.
 * Böylece "Z e u s", "z-e-u-s", "ZEUS", "Zéus" ve "zeus" aynı dizgeye
 * iner — büyük/küçük harf, boşluk ve noktalama ekleyerek kaçma
 * denemeleri tek adımda kapanır.
 */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * "=" işaretini KORUYAN normalleştirme — yalnız dolgulu (padded) base64
 * parmak izleri için.
 *
 * Neden gerekli (G3'te ölçülerek bulundu): tek karakterlik "0" başlığının
 * base64'ü "MA==" olup normalleştirilince 2 karaktere ("ma") iner. Bu
 * kadar kısa bir izi alt-dizi olarak aramak normal İngilizceyi yıkar
 * ("I am a referee" → "iamareferee" içinde "ma" var). Token olarak
 * aramak ise "M A = =" gibi boşluklu yazımı kaçırıyordu. Çözüm: dolgu
 * işaretini koruyarak aramak — "ma==" dizgesi düz metinde ASLA
 * geçmez, ama boşluklu base64'te aynen belirir.
 */
function normalizeEsitli(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9=]/g, "");
}

function tokenize(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function tersCevir(s: string): string {
  return [...s].reverse().join("");
}

function rot13(s: string): string {
  return s.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// --------------------------------------------------------- parmak izi

/**
 * Bir sırrın aranacak tüm kodlanmış hâlleri (normalleştirilmiş).
 * Kodlamalar normalleştirmeden ÖNCE uygulanır, sonra normalleştirilir —
 * böylece metindeki "UHlyZXg=" ile sırrın base64'ü aynı dizgede buluşur.
 */
export interface ParmakIzi {
  iz: string;
  /**
   * Bu iz yalnız tam sözcük (token) olarak mı aranır?
   *
   * Karar İZİN KENDİ uzunluğuna göre verilir, sırrın uzunluğuna göre
   * DEĞİL (G3'te ölçülerek bulundu): tek karakterlik "0" sırrı token
   * aranmak zorundadır, ama onun base64'ü ("MA==" → "ma") iki
   * karakterdir ve "M A = =" gibi boşluklu bir yazımda token olarak
   * görünmez — alt-dizi aranması gerekir. İzi sırra göre sınıflamak,
   * boşluklu-base64 kaçışını açık bırakıyordu.
   */
  yalnizToken: boolean;
  /** Hangi normalleştirme alanında aranacak. */
  alan: "norm" | "esitli";
}

export function parmakIzleri(sir: string): ParmakIzi[] {
  const base64 = Buffer.from(sir, "utf-8").toString("base64");
  const ham: string[] = [
    sir,
    tersCevir(sir),
    rot13(sir),
    base64,
    Buffer.from(sir, "utf-8").toString("hex"),
    [...sir].map((c) => c.charCodeAt(0)).join(" "),
  ];
  const izler = new Map<string, ParmakIzi>();
  for (const h of ham) {
    const n = normalize(h);
    if (n.length === 0) continue;
    const mevcut = izler.get(`norm:${n}`);
    const yalnizToken = n.length < KISA_DEGER_ESIGI;
    // Aynı iz iki yoldan gelirse en GEVŞEK olmayan (alt-dizi) kazanır.
    if (mevcut === undefined || (mevcut.yalnizToken && !yalnizToken)) {
      izler.set(`norm:${n}`, { iz: n, yalnizToken, alan: "norm" });
    }
  }

  // Dolgulu base64: "=" korunarak alt-dizi aranır (bkz. normalizeEsitli).
  if (base64.includes("=")) {
    const ne = normalizeEsitli(base64);
    if (ne.length > 0) {
      izler.set(`esitli:${ne}`, { iz: ne, yalnizToken: false, alan: "esitli" });
    }
  }

  return [...izler.values()];
}

/**
 * Metindeki kodlama şüphesi taşıyan parçaları çözmeye çalışır. Hedef,
 * sırrın KODLANMIŞ BİR CÜMLENİN İÇİNDE geçtiği durumu yakalamaktır
 * ("the answer is Zeus" → base64).
 */
export function kodlamaAdaylari(metin: string): string[] {
  const adaylar: string[] = [rot13(metin)];

  for (const m of metin.matchAll(/[A-Za-z0-9+/]{4,}={0,2}/g)) {
    try {
      const cozulmus = Buffer.from(m[0], "base64").toString("utf-8");
      if (cozulmus.length > 0) adaylar.push(cozulmus);
    } catch {
      // çözülemeyen parça göz ardı edilir; metin düz/ters hâlinde zaten sınanıyor
    }
  }

  for (const m of metin.matchAll(/(?:[0-9a-fA-F]{2}[\s,:-]?){2,}/g)) {
    const hexOnly = m[0].replace(/[^0-9a-fA-F]/g, "");
    if (hexOnly.length % 2 !== 0) continue;
    try {
      const cozulmus = Buffer.from(hexOnly, "hex").toString("utf-8");
      if (cozulmus.length > 0) adaylar.push(cozulmus);
    } catch {
      // bkz. yukarıdaki not
    }
  }

  // Ondalık karakter kodları ("90 101 117 115"). TÜM kod noktaları
  // korunur: ASCII dışını atmak, "__diğer__" gibi değerlerdeki ğ'yi
  // düşürüp sızıntıyı kaçırıyordu (G3'te ölçülerek bulundu).
  const sayilar = metin.match(/\b\d{1,7}\b/g);
  if (sayilar !== null && sayilar.length >= 3) {
    let cozulmus = "";
    for (const n of sayilar) {
      const kod = Number(n);
      if (kod >= 1 && kod <= 0x10ffff) {
        try {
          cozulmus += String.fromCodePoint(kod);
        } catch {
          // geçersiz kod noktası — atla
        }
      }
    }
    if (cozulmus.length > 0) adaylar.push(cozulmus);
  }

  return adaylar;
}

// ------------------------------------------------------------- süzme

interface YasakliSir {
  sebep: SuzgecSebebi;
  izler: ParmakIzi[];
}

/**
 * Hakemin KENDİ meşru değerinin kaçınılmaz olarak tetiklediği yasak
 * değerler listeden düşer.
 *
 * Bu, aşağıdaki eşitlik kuralının doğal genellemesidir. Normalleştirme
 * boşlukları attığı için kapalı/kısa sözcük kümesinden gelen bir dilim
 * değeri, uzun ve tamamen meşru bir başka dilim değerinin İÇİNDE
 * sözcük sınırlarını aşarak belirebiliyor (G3'te ölçülerek bulundu):
 *   - `Airline` / enBuyuk → kendi kategorisi "Category:Economics of
 *     transp·**ort a**·nd utility industries"; normalleştirilince
 *     "transportand" içinde `derece`="orta" var.
 *   - `Climate change in Indonesia` → ters okumada benzer çakışma.
 * Bu iki durumda kategori hakeminin KENDİ meşru yanıtı kesiliyordu.
 *
 * Çözüm: yasak değeri, hakemin kendi değerine süzgecin KENDİ eşleşme
 * mantığıyla sor. Kendi değerini söylemek şu yasak değeri zorunlu
 * olarak "sızdırıyorsa", o değer bu hakem için zaten gizlenemez —
 * listede tutmak yalnız meşru yanıtı kesmeye yarar.
 *
 * Bu, alt-dizi aramasını HİÇBİR yerde gevşetmez (tam sözcük aramasına
 * geçmek, "_ _ d i ğ e r _ _" gibi araya karakter serpilmiş
 * sızıntıların süzgeci geçmesine yol açıyordu — ölçüldü ve reddedildi).
 */
function kendiDegeriKaciniLmazKiliyorMu(sir: YasakliSir, izinliAdaylari: Aday[]): boolean {
  return eslesmeBul(sir, izinliAdaylari) !== undefined;
}

function yasakliSirlar(ctx: SuzgecBaglami): YasakliSir[] {
  const izinli = normalize(ctx.izinliDeger);
  const sonuc: YasakliSir[] = [];

  function ekle(
    deger: string,
    sebep: SuzgecSebebi,
    secenekler: { kisaDusur: boolean; izinliDusur: boolean }
  ): void {
    const n = normalize(deger);
    if (n.length === 0) return;
    /**
     * KRİTİK: bir başka hakemin dilim değeri, bu hakemin KENDİ dilim
     * değeriyle aynı dizgeye inebilir (örn. `bolge`="orta" ve
     * `derece`="orta"). Böyle bir değeri yasaklamak, hakemin meşru
     * yanıtını kendi süzgecine kurban eder.
     *
     * Bu eleme YALNIZ başka-hakem dilim değerleri için geçerlidir
     * (`izinliDusur`). Gerçek başlık ve sayfa kimliği HİÇBİR koşulda
     * düşmez — G4B-2b Bulgu 3: eleme onlara da uygulandığı için, hakemin
     * kendi değeri başlıkla aynı dizgeye indiğinde (dünyada ulaşılabilir
     * tek durum: `"0"` başlıklı sayfa + `harf`/`hareket` dilimi "0")
     * gerçek başlık yasak listesine HİÇ eklenmiyor ve süzgeç onu
     * engellemiyordu. Bedeli bilinçli olarak kabul edilir: o sayfada
     * hakemin kendi meşru değeri de kesilir — çünkü o dizge aynı anda
     * TAM KONUMun kendisidir (fail-closed, bkz. dosya başlığı).
     */
    if (secenekler.izinliDusur && n === izinli) return;
    if (secenekler.kisaDusur && n.length < KISA_DEGER_ESIGI) return;

    sonuc.push({ sebep, izler: parmakIzleri(deger) });
  }

  ekle(ctx.gercekBaslik, "baslik", { kisaDusur: false, izinliDusur: false });
  if (ctx.sayfaKimligi !== undefined) {
    ekle(String(ctx.sayfaKimligi), "sayfaKimligi", {
      kisaDusur: false,
      izinliDusur: false,
    });
  }
  for (const d of ctx.digerDilimDegerleri ?? []) {
    // Kısa dilim değerleri düşürülür — bkz. KISA_DEGER_ESIGI notu.
    ekle(d, "digerDilim", { kisaDusur: true, izinliDusur: true });
  }

  /**
   * Gerçek başlık ve sayfa kimliği bu elemeye GİRMEZ: onlar her koşulda
   * korunur. Yalnız başka-hakem dilim değerleri, hakemin kendi değeri
   * onları zorunlu kılıyorsa düşürülür.
   *
   * Aynı muafiyet `ekle()`'nin eşitlik elemesinde de uygulanır
   * (`izinliDusur`) — G4B-2b Bulgu 3'te bu iki adım birbirinden kaymıştı:
   * değer bu `filter`'a GELMEDEN düşüyordu.
   */
  const izinliAdaylari = adaylar(ctx.izinliDeger);
  return sonuc.filter(
    (sir) =>
      sir.sebep !== "digerDilim" || !kendiDegeriKaciniLmazKiliyorMu(sir, izinliAdaylari)
  );
}

interface Aday {
  norm: string;
  esitli: string;
  tokenlar: string[];
  varyant: SuzgecVaryanti;
}

function adaylar(metin: string): Aday[] {
  const duz = normalize(metin);
  const duzTokenlar = tokenize(metin);
  const duzEsitli = normalizeEsitli(metin);

  const liste: Aday[] = [
    { norm: duz, esitli: duzEsitli, tokenlar: duzTokenlar, varyant: "duz" },
    {
      norm: tersCevir(duz),
      esitli: tersCevir(duzEsitli),
      tokenlar: duzTokenlar.map(tersCevir),
      varyant: "ters",
    },
  ];

  for (const k of kodlamaAdaylari(metin)) {
    const n = normalize(k);
    const t = tokenize(k);
    const e = normalizeEsitli(k);
    liste.push({ norm: n, esitli: e, tokenlar: t, varyant: "kodlama" });
    liste.push({
      norm: tersCevir(n),
      esitli: tersCevir(e),
      tokenlar: t.map(tersCevir),
      varyant: "kodlama",
    });
  }

  return liste;
}

/**
 * Bir yasak sırrı aday listesinde arar; bulursa yakalayan varyantı
 * döner. Hem `suz()` hem de kendi-değer elemesi BU fonksiyonu kullanır
 * — eleme ile asıl süzme arasında mantık farkı kalmaması için
 * (kopyalanmış iki eşleştirici kaçınılmaz olarak birbirinden kayardı).
 */
function eslesmeBul(sir: YasakliSir, adayListesi: Aday[]): SuzgecVaryanti | undefined {
  for (const aday of adayListesi) {
    for (const iz of sir.izler) {
      let yakalandi: boolean;
      if (iz.alan === "esitli") {
        yakalandi = aday.esitli.includes(iz.iz);
      } else if (iz.yalnizToken) {
        yakalandi = aday.tokenlar.includes(iz.iz);
      } else {
        yakalandi = aday.norm.includes(iz.iz);
      }
      if (yakalandi) return aday.varyant;
    }
  }
  return undefined;
}

/**
 * Model/kullanıcı yanıtını süzer. Yakalanırsa metin SABIT_RED_YANITI ile
 * tamamen DEĞİŞTİRİLİR (kırpılmaz — kısmi metin de sızdırabilir).
 */
export function suz(metin: string, ctx: SuzgecBaglami): SuzgecSonucu {
  const sirlar = yasakliSirlar(ctx);
  const adayListesi = adaylar(metin);

  for (const sir of sirlar) {
    const varyant = eslesmeBul(sir, adayListesi);
    if (varyant !== undefined) {
      return {
        metin: SABIT_RED_YANITI,
        engellendi: true,
        sebep: sir.sebep,
        varyant,
      };
    }
  }

  return { metin, engellendi: false };
}
