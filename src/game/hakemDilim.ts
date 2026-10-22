import type { MatchState, PageTitle, WorldPage } from "./types";
import { distance, outDegree, type WorldData } from "./world";

/**
 * SPEC §6 hakem bilgi dilimleri — ÜRETİM tanımı.
 *
 * G2B/G2C/G2D'nin `test/slices.ts` modülü yalnız ÖLÇÜM içindi ve eski
 * (alfabetik) kategori kuralını taşıyor; o dosya geçmiş ölçümlerin
 * tekrarlanabilirliği için OLDUĞU GİBİ bırakıldı. Bu modül üretim
 * sözleşmesidir. İkisinin kurala-bağımsız dilimlerde (bölge/hareket/
 * harf/derece) birebir aynı sonucu verdiği `test/hakem_dilim.test.ts`
 * içindeki sapma (drift) testiyle her koşuda doğrulanır.
 */

export type DilimTuru = "kategori" | "bolge" | "hareket" | "harf" | "derece";

export const TUM_DILIM_TURLERI: readonly DilimTuru[] = Object.freeze([
  "kategori",
  "bolge",
  "hareket",
  "harf",
  "derece",
]);

/** Hiçbir kategori kuralın eşiğini geçmediğinde dönen değer. */
export const DIGER = "__diğer__";

export type Band = "yakın" | "orta" | "uzak";
export type DereceBandi = "düşük" | "orta" | "yüksek";

/** Bir hakeme verilen tek bilgi birimi: dilim türü + o turdaki değeri. */
export interface Dilim {
  tur: DilimTuru;
  deger: string;
}

// ---------------------------------------------------------------- kategori

/**
 * Kategori dilimi seçim kuralları (G3'te ölçülerek seçilir, bkz.
 * `test/kategori_kural.ts`):
 * - `uye6`   : üye sayısı ≥6 olan kategorilerden tohumlu karma ile
 * - `enBuyuk`: sayfanın en kalabalık kategorisi (karma yok)
 * - `uye2`   : üye sayısı ≥2 olan kategorilerden tohumlu karma ile
 */
/**
 * KASITLI OLARAK VARSAYILAN DEĞER YOK (`VARSAYILAN_KATEGORI_KURALI`
 * diye bir sabit aramayın — bilerek kaldırıldı). G3 Madde 1 ölçümünde
 * üç kuralın HİÇBİRİ goal'ün ölçütünü ("diğer" ≤%25 VE kategori-tek-
 * başına medyan aday 20–150) sağlamadı ve bu veri kümesinde sağlanması
 * olanaksız (bkz. DEFTER.md "G3" girişi). Kural seçimi DeeOne'ın
 * kararıdır; o karar verilene kadar `kategoriKurali` her çağrıda
 * AÇIKÇA verilmek zorundadır — sessiz bir varsayılan, ölçülmemiş bir
 * kuralı üretime kaçırırdı.
 */
export type KategoriKurali = "uye6" | "enBuyuk" | "uye2";

/** FNV-1a benzeri deterministik string hash (kripto DEĞİL, yalnız tohumlu seçim). */
export function dilimHash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Kategori -> yüklü dünya alt kümesindeki üye sayısı. */
export function kategoriUyeSayilari(pages: readonly WorldPage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of pages) {
    for (const c of p.categories) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Bir kategori değeri, sayfanın gerçek başlığını sızdırıyor mu?
 *
 * Gerçek bir risk: "Category:Frédéric Chopin" gibi bir kategori, üyesi
 * olan "Frédéric Chopin" sayfasının TAM BAŞLIĞINI içerir. Böyle bir
 * değer hakeme verilirse hakem dürüstçe dilimini söylerken tam konumu
 * ifşa eder ve çıkış süzgeci (fail-closed olduğu için) kendi hakeminin
 * meşru yanıtını bile keser. Bu yüzden böyle kategoriler dilim
 * ÜRETİMİNDE elenir — koruma süzgeçten önce, kaynakta.
 */
export function kategoriBasligiSizdiriyor(kategori: string, title: PageTitle): boolean {
  const k = kategori.replace(/^Category:/, "").toLocaleLowerCase("en");
  const t = title.toLocaleLowerCase("en");
  /**
   * Eşik 3 (G3'te ölçülerek düşürüldü — önce 4'tü): 3 harfli "DNA"
   * sayfası eşiğin altında kalıyordu, "Category:DNA" elenmiyordu ve
   * kategori hakeminin KENDİ meşru yanıtı çıkış süzgecine takılıyordu.
   * 1–2 karakterlik başlıklar (dünyada tek örnek: "0") muaf kalır:
   * onlar için her rakam içeren kategori elenirdi.
   */
  if (t.length < 3) return false;
  return k.includes(t);
}

/**
 * SPEC §6 "kategori: sayfanın Wikipedia kategorilerinden biri".
 * Kural eşiğini geçen kategori yoksa DIGER döner.
 */
export function kategoriDilimi(
  page: WorldPage,
  uyeSayilari: Map<string, number>,
  kural: KategoriKurali
): string {
  const uygun = page.categories
    .filter((c) => !kategoriBasligiSizdiriyor(c, page.title))
    .filter((c) => {
      const n = uyeSayilari.get(c) ?? 0;
      if (kural === "uye6") return n >= 6;
      if (kural === "uye2") return n >= 2;
      return n >= 1; // enBuyuk: tüm kategoriler yarışır
    })
    .sort(); // kararlı indeksleme; SEÇİM aşağıda yapılır

  if (uygun.length === 0) return DIGER;

  if (kural === "enBuyuk") {
    let best = uygun[0];
    let bestN = uyeSayilari.get(best) ?? 0;
    for (const c of uygun) {
      const n = uyeSayilari.get(c) ?? 0;
      if (n > bestN) {
        best = c;
        bestN = n;
      }
    }
    return best;
  }

  return uygun[dilimHash(page.title) % uygun.length];
}

// ------------------------------------------------- bölge / harf / derece

/** SPEC §6 bant eşikleri (G2B'de ölçümle doğrulandı, değiştirilmedi). */
export function bandOf(d: number): Band {
  if (d <= 2) return "yakın";
  if (d <= 4) return "orta";
  return "uzak";
}

export interface DereceEsikleri {
  dusukUst: number;
  ortaUst: number;
}

/** Çıkan-derece dağılımının tertile sınırları (dünya başına bir kez). */
export function dereceEsikleriHesapla(world: WorldData): DereceEsikleri {
  const degrees = world.titles.map((t) => outDegree(world, t)).sort((a, b) => a - b);
  const n = degrees.length;
  if (n === 0) throw new Error("dereceEsikleriHesapla: dünyada hiç sayfa yok");
  const dusukUst = degrees[Math.floor(n / 3) - 1] ?? degrees[0];
  const ortaUst = degrees[Math.floor((2 * n) / 3) - 1] ?? degrees[n - 1];
  return Object.freeze({ dusukUst, ortaUst });
}

export function dereceDilimi(
  world: WorldData,
  title: PageTitle,
  esikler: DereceEsikleri
): DereceBandi {
  const d = outDegree(world, title);
  if (d <= esikler.dusukUst) return "düşük";
  if (d <= esikler.ortaUst) return "orta";
  return "yüksek";
}

export function harfDilimi(title: PageTitle): string {
  return title.charAt(0).toLocaleUpperCase("en");
}

export function bolgeDilimi(
  world: WorldData,
  avciPos: PageTitle,
  kacakPos: PageTitle
): Band | null {
  const d = distance(world, avciPos, kacakPos);
  return d === undefined ? null : bandOf(d);
}

/** "Kaçak'ın son kaç turdur yerinde kaldığı" — sayfa özniteliği DEĞİL. */
export function hareketDilimi(kacakStayStreak: number): number {
  return kacakStayStreak;
}

// ------------------------------------------------------- dilim üretimi

export interface DilimBaglami {
  esikler: DereceEsikleri;
  uyeSayilari: Map<string, number>;
  /** Zorunlu — bkz. VARSAYILAN_KATEGORI_KURALI'nın kaldırılma notu. */
  kategoriKurali: KategoriKurali;
}

/**
 * Gerçek maç durumundan bir dilim değeri üretir. ÇAĞIRAN SORUMLULUĞU:
 * bu fonksiyonun çıktısı dışında hiçbir şey hakeme verilmez.
 */
export function dilimUret(
  world: WorldData,
  state: MatchState,
  tur: DilimTuru,
  ctx: DilimBaglami
): Dilim {
  switch (tur) {
    case "kategori": {
      const page = world.pages.get(state.kacakPosition);
      if (page === undefined) {
        throw new Error(`dilimUret: bilinmeyen sayfa ${state.kacakPosition}`);
      }
      return {
        tur,
        deger: kategoriDilimi(page, ctx.uyeSayilari, ctx.kategoriKurali),
      };
    }
    case "bolge": {
      const v = bolgeDilimi(world, state.avciPosition, state.kacakPosition);
      return { tur, deger: v ?? "bilinmiyor" };
    }
    case "hareket":
      return { tur, deger: String(hareketDilimi(state.kacakStayStreak)) };
    case "harf":
      return { tur, deger: harfDilimi(state.kacakPosition) };
    case "derece":
      return { tur, deger: dereceDilimi(world, state.kacakPosition, ctx.esikler) };
    default: {
      const _exhaustive: never = tur;
      throw new Error(`dilimUret: bilinmeyen dilim türü ${String(_exhaustive)}`);
    }
  }
}

/**
 * Bir dilim değeriyle TUTARLI sayfa kümesi (Avcı tarafı çıkarım; hakem
 * katmanı bunu kullanmaz, ölçüm ve istemci botları kullanır).
 * `hareket` daraltma gücü taşımaz (bkz. hareketDilimi notu).
 */
export function dilimeUyanSayfalar(
  world: WorldData,
  pages: readonly WorldPage[],
  dilim: Dilim,
  ctx: DilimBaglami & { avciPos: PageTitle }
): WorldPage[] {
  switch (dilim.tur) {
    case "kategori":
      return pages.filter(
        (p) => kategoriDilimi(p, ctx.uyeSayilari, ctx.kategoriKurali) === dilim.deger
      );
    case "harf":
      return pages.filter((p) => harfDilimi(p.title) === dilim.deger);
    case "derece":
      return pages.filter((p) => dereceDilimi(world, p.title, ctx.esikler) === dilim.deger);
    case "bolge":
      return pages.filter((p) => bolgeDilimi(world, ctx.avciPos, p.title) === dilim.deger);
    case "hareket":
      return [...pages];
    default: {
      const _exhaustive: never = dilim.tur;
      throw new Error(`dilimeUyanSayfalar: bilinmeyen dilim türü ${String(_exhaustive)}`);
    }
  }
}
