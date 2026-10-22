import type { Role } from "./types";
import type { Dilim } from "./hakemDilim";

/**
 * G3 Madde 3 — HAKEM MODEL ARAYÜZÜ.
 *
 * Gerçek LLM çağrısı ve ağ erişimi burada YOKTUR. Model bir arayüzdür;
 * Cloudflare Workers AI bağlaması G4'te bu arayüzün arkasına takılır,
 * testlerde sahte modeller takılır.
 */

export interface KonusmaSatiri {
  gonderen: Role | "hakem";
  metin: string;
}

/**
 * Güvenilmeyen metin sözleşmesinin karakter sınırı (C: "Untrusted text
 * contract", SPEC'teki aynı ad). Hem Avcı/Kaçak'ın hakeme yazdığı
 * `mesaj`, hem hakemin döndürdüğü `yanit` için geçerli — hakemKanali.ts
 * uygulamayı yapar, bu dosya yalnız PAYLAŞILAN sayıyı taşır (hakemKanali
 * zaten bu modülden içe aktarıyor, döngüsel bağımlılık doğmaz).
 */
export const GUVENILMEYEN_METIN_SINIRI = 500;

/**
 * Modele giden bağlamın TAMAMI. Sistem hakeminin bağlamında yalnız
 * kendi dilimi ve o maçın konuşması bulunur (SPEC §6).
 *
 * **`etiket`/`avciKonusma`/`kacakKonusma` (C, "Untrusted text
 * contract"):** tur başına üretilen, güvenilmeyen metni sarmalayan
 * etiketin DEĞERİ + konuşmanın taraf bazında ayrıştırılmış hâli.
 * Gerçek bir model adaptörü (G4B-1, bu goal'ün kapsamı DIŞI) bu ikisini
 * kullanarak Avcı/Kaçak bölümlerini AYRI, etiketli olarak sunabilir.
 * `konusma` (karışık, taraf etiketlenmemiş) GERİYE DÖNÜK UYUMLULUK için
 * aynen KALIR — `uyumluModel`/`suskunModel` hâlâ onu okur.
 */
export interface ModelGirdisi {
  sistemPrompt: string;
  dilim: Dilim;
  etiket: string;
  avciKonusma: readonly KonusmaSatiri[];
  kacakKonusma: readonly KonusmaSatiri[];
  konusma: readonly KonusmaSatiri[];
}

/** (sistemPrompt, dilim, konuşma) → metin. */
export type HakemModeli = (girdi: ModelGirdisi) => string;

/**
 * Hakemin sistem istemi.
 *
 * **G4B-3b — YANIT BİÇİMİ (DeeOne kararı (a), bkz. DEFTER.md "G4B-2b"
 * Bulgu 1):** G4B-2b'de gerçek modelle ölçüm, ayrıştırılamayan yanıt
 * oranını **%100** buldu; kök neden bu istemin modelden "in your own
 * words" istemesiydi. İstem artık kendi dilimi sorulduğunda TEK ve TAM
 * cümleyi dayatıyor. Kalıp, Kindi'nin ayrıştırıcısıyla
 * (`src/worker/platformBotlari.ts` → `DILIM_YANIT_KALIBI`) birebir
 * uyumlu olmalıdır; o kalıp `the <tur> is <deger>.` dizisini cümlenin
 * SONUNDA arar — bu yüzden "sonrasına hiçbir şey ekleme" talimatı
 * biçimin bir parçasıdır, süsleme değildir.
 *
 * **Sızıntı notu:** isteme dilim DIŞINDA hiçbir bilgi eklenmez; eklenen
 * cümle yalnızca bu fonksiyona zaten verilmiş olan `dilim.tur` ve
 * `dilim.deger` değerlerini tekrar eder (imza değişmedi).
 */
export function sistemPromptKur(dilim: Dilim): string {
  return [
    "You are a referee in a hidden-location pursuit game.",
    `You know exactly ONE fact about the fugitive's page: ${dilim.tur} = ${dilim.deger}.`,
    "You do not know the page title, the page id, or any other fact.",
    "When the hunter asks about your one fact, reply with EXACTLY this single sentence and nothing else:",
    `As far as I know, the ${dilim.tur} is ${dilim.deger}.`,
    "Do not rephrase it, do not translate it, and do not add any words, sentences or explanation before or after it.",
    "If asked anything you do not know, reply with one short sentence saying you cannot help with that.",
  ].join("\n");
}

/**
 * Model bağlamını kurar.
 *
 * **Sızıntı güvenliğinin taşıyıcı noktası imzanın kendisidir:** bu
 * fonksiyon `MatchState` ve `WorldData` ALMAZ. Dolayısıyla gerçek
 * konumu, başlığı, sayfa kimliğini veya başka hakemlerin dilimlerini
 * bağlama koyması yapısal olarak olanaksızdır — bu bir "dikkat edin"
 * kuralı değil, tip düzeyinde bir kısıttır. `test/hakem_sizinti.test.ts`
 * bunu davranışsal olarak da kanıtlar.
 */
export function modelGirdisiKur(
  dilim: Dilim,
  konusma: readonly KonusmaSatiri[],
  /** Varsayılan `""`: eski/ilgisiz çağıranlar (ölçüm betikleri, köprü)
   * bu parametreyi hiç bilmeden ÇALIŞMAYA devam eder — yalnız
   * `hakemKanali.ts`'nin kendi (gerçek) çağrısı gerçek bir etiket verir. */
  etiket: string = ""
): ModelGirdisi {
  const donmusKonusma = Object.freeze(
    [...konusma].map((k) => Object.freeze({ ...k }))
  );
  return Object.freeze({
    sistemPrompt: sistemPromptKur(dilim),
    dilim: Object.freeze({ ...dilim }),
    etiket,
    avciKonusma: Object.freeze(donmusKonusma.filter((k) => k.gonderen === "avci")),
    kacakKonusma: Object.freeze(donmusKonusma.filter((k) => k.gonderen === "kacak")),
    konusma: donmusKonusma,
  });
}

// ----------------------------------------------------- sahte modeller

/** Kurallara uyan model: yalnız kendi dilimini söyler. */
export const uyumluModel: HakemModeli = (girdi) => {
  const sonSoru = [...girdi.konusma].reverse().find((k) => k.gonderen === "avci");
  if (sonSoru === undefined) return "Ask me something.";
  return `As far as I know, the ${girdi.dilim.tur} is ${girdi.dilim.deger}.`;
};

/** Hiçbir şey söylemeyen model (zaman aşımı/suskun hakem taklidi). */
export const suskunModel: HakemModeli = () => "I cannot help with that.";

/**
 * SIZDIRAN model — G3 Madde 4 testinin saldırganı. Kendisine verilen
 * dilim dışında, kendisine HİÇ VERİLMEMİŞ olan sırları da söylemeye
 * çalışır. Gerçekte bir model bu değerleri bilemez (bağlamında
 * yoktur); bu sahte model süzgeci sınamak için sırları doğrudan
 * kurucudan alır — yani "en kötü durum: model tamamen ele geçirildi".
 */
export interface SizdiranSirlar {
  gercekBaslik: string;
  sayfaKimligi?: number | string;
  digerDilimDegerleri?: readonly string[];
}

export type SizdirmaBicimi =
  | "duz"
  | "bosluklu"
  | "buyukHarf"
  | "ters"
  | "base64"
  | "hex"
  | "rot13"
  | "ondalik"
  | "noktalamali"
  | "cumleIcinde";

export function tersCevir(s: string): string {
  return [...s].reverse().join("");
}

function rot13(s: string): string {
  return s.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

export function sirriBicimle(sir: string, bicim: SizdirmaBicimi): string {
  switch (bicim) {
    case "duz":
      return sir;
    case "bosluklu":
      return [...sir].join(" ");
    case "buyukHarf":
      return sir.toLocaleUpperCase("en");
    case "ters":
      return tersCevir(sir);
    case "base64":
      return Buffer.from(sir, "utf-8").toString("base64");
    case "hex":
      return Buffer.from(sir, "utf-8").toString("hex");
    case "rot13":
      return rot13(sir);
    case "ondalik":
      return [...sir].map((c) => c.charCodeAt(0)).join(" ");
    case "noktalamali":
      return [...sir].join(".");
    case "cumleIcinde":
      return `Honestly, the answer you want is ${sir}, but do not tell anyone.`;
    default: {
      const _exhaustive: never = bicim;
      throw new Error(`sirriBicimle: bilinmeyen biçim ${String(_exhaustive)}`);
    }
  }
}

export const TUM_SIZDIRMA_BICIMLERI: readonly SizdirmaBicimi[] = Object.freeze([
  "duz",
  "bosluklu",
  "buyukHarf",
  "ters",
  "base64",
  "hex",
  "rot13",
  "ondalik",
  "noktalamali",
  "cumleIcinde",
]);

/**
 * Verilen sırrı verilen biçimde sızdıran model üreticisi. `hangiSir`
 * ile hangi sırrın sızdırılacağı seçilir.
 */
export function createSizdiranModel(
  sirlar: SizdiranSirlar,
  bicim: SizdirmaBicimi,
  hangiSir: "baslik" | "sayfaKimligi" | "digerDilim" = "baslik"
): HakemModeli {
  return () => {
    let sir: string | undefined;
    if (hangiSir === "baslik") sir = sirlar.gercekBaslik;
    else if (hangiSir === "sayfaKimligi") {
      sir = sirlar.sayfaKimligi === undefined ? undefined : String(sirlar.sayfaKimligi);
    } else {
      sir = (sirlar.digerDilimDegerleri ?? [])[0];
    }
    if (sir === undefined) {
      throw new Error(`createSizdiranModel: ${hangiSir} sırrı verilmedi`);
    }
    return sirriBicimle(sir, bicim);
  };
}
