import type { PageTitle, WorldPage } from "../src/game/types";
import { distance, outDegree, type WorldData } from "../src/game/world";

export type Band = "yakın" | "orta" | "uzak";

export function bandOf(d: number): Band {
  if (d <= 2) return "yakın";
  if (d <= 4) return "orta";
  return "uzak";
}

/**
 * SPEC §6 dilim türleri — yalnız ölçüm amaçlı, test/ altında. Hiçbiri tam
 * mesafe veya tam konum İÇERMEZ (bölge bantlanmış, hareket bir davranış
 * sayacı, kategori/harf/derece sayfa öznitelikleridir).
 */
export type SliceType = "kategori" | "bolge" | "hareket" | "harf" | "derece";

export const ALL_SLICE_TYPES: SliceType[] = ["kategori", "bolge", "hareket", "harf", "derece"];

export interface DereceEsikleri {
  dusukUst: number; // bu değere kadar (dahil) "düşük"
  ortaUst: number; // bu değere kadar (dahil) "orta", ötesi "yüksek"
}

/**
 * Çıkan-derece dağılımını tertile'lara böler (SCC dünyası üzerinde, bir
 * kez hesaplanır). Sınırlar DereceEsikleri olarak raporlanır.
 */
export function computeDereceEsikleri(world: WorldData): DereceEsikleri {
  const degrees = world.titles.map((t) => outDegree(world, t)).sort((a, b) => a - b);
  const n = degrees.length;
  const dusukUst = degrees[Math.floor(n / 3) - 1] ?? degrees[0];
  const ortaUst = degrees[Math.floor((2 * n) / 3) - 1] ?? degrees[n - 1];
  return { dusukUst, ortaUst };
}

export type DereceBandi = "düşük" | "orta" | "yüksek";

export function dereceSlice(
  world: WorldData,
  title: PageTitle,
  esikler: DereceEsikleri
): DereceBandi {
  const d = outDegree(world, title);
  if (d <= esikler.dusukUst) return "düşük";
  if (d <= esikler.ortaUst) return "orta";
  return "yüksek";
}

export function harfSlice(title: PageTitle): string {
  return title.charAt(0).toLocaleUpperCase("en");
}

/** SPEC §6: "sayfanın kategorilerinden biri" — deterministik olarak
 * alfabetik en küçük kategori seçilir (tekrarlanabilirlik için). */
export function kategoriSlice(page: WorldPage): string | null {
  if (page.categories.length === 0) return null;
  return [...page.categories].sort()[0];
}

export function bolgeSlice(world: WorldData, avciPos: PageTitle, kacakPos: PageTitle): Band | null {
  const d = distance(world, avciPos, kacakPos);
  return d === undefined ? null : bandOf(d);
}

/**
 * "Kaçak'ın son kaç turdur yerinde kaldığı" — bu bir SAYFA özniteliği
 * DEĞİL, Kaçak'ın davranış geçmişi. Aday kümesi daraltma amacıyla
 * kullanılamaz (hangi sayfada olduğuna dair bilgi taşımaz) — bu KASITLI
 * bir bulgu, hata değil: hareketSliceFiltrele() her sayfayı kabul eder.
 */
export function hareketSlice(kacakStayStreak: number): number {
  return kacakStayStreak;
}

/**
 * Bir dilim türü + değeri verildiğinde, bu değerle TUTARLI sayfaların
 * kümesini döner. hareket için bu her zaman tüm sayfa kümesidir (bkz.
 * hareketSlice yorumu) — kasıtlı no-op, daraltma gücü sıfır.
 */
export function filterByCandidate(
  world: WorldData,
  pages: WorldPage[],
  sliceType: SliceType,
  value: unknown,
  ctx: { avciPos?: PageTitle; esikler?: DereceEsikleri }
): WorldPage[] {
  switch (sliceType) {
    case "kategori":
      return pages.filter((p) => kategoriSlice(p) === value);
    case "harf":
      return pages.filter((p) => harfSlice(p.title) === value);
    case "derece":
      if (!ctx.esikler) throw new Error("derece filtresi için esikler gerekli");
      return pages.filter((p) => dereceSlice(world, p.title, ctx.esikler!) === value);
    case "bolge":
      if (!ctx.avciPos) throw new Error("bolge filtresi için avciPos gerekli");
      return pages.filter((p) => bolgeSlice(world, ctx.avciPos!, p.title) === value);
    case "hareket":
      return pages; // bkz. yukarıdaki not — daraltma gücü yok
    default:
      throw new Error(`Bilinmeyen dilim türü: ${sliceType}`);
  }
}
