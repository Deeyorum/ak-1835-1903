import type { PageTitle, WorldPage } from "../src/game/types";

export const DIGER = "__diğer__";

/** Doğum/ölüm yılı tipi kategori mi (örn. "1943 births", "1828 deaths")? */
export function isBirthDeathCategory(categoryTitle: string): boolean {
  const stripped = categoryTitle.replace(/^Category:/, "");
  return /^\d{3,4}\s+(births|deaths)$/i.test(stripped.trim());
}

export interface CategoryDistribution {
  memberCounts: Map<string, number>; // kategori -> üye sayısı (SCC içinde)
  histogram: { bucket: string; count: number }[];
  birthDeathCategoryCount: number;
  birthDeathCategoryShare: number; // tüm benzersiz kategoriler içindeki payı
  birthDeathMemberShare: number; // tüm (sayfa,kategori) çiftleri içindeki payı
}

export function computeCategoryDistribution(pages: WorldPage[]): CategoryDistribution {
  const memberCounts = new Map<string, number>();
  let totalMemberships = 0;
  let birthDeathMemberships = 0;

  for (const p of pages) {
    for (const c of p.categories) {
      memberCounts.set(c, (memberCounts.get(c) ?? 0) + 1);
      totalMemberships++;
      if (isBirthDeathCategory(c)) birthDeathMemberships++;
    }
  }

  const buckets = [
    { label: "1", test: (n: number) => n === 1 },
    { label: "2–5", test: (n: number) => n >= 2 && n <= 5 },
    { label: "6–19", test: (n: number) => n >= 6 && n <= 19 },
    { label: "20–49", test: (n: number) => n >= 20 && n <= 49 },
    { label: "50+", test: (n: number) => n >= 50 },
  ];
  const histogram = buckets.map((b) => ({
    bucket: b.label,
    count: Array.from(memberCounts.values()).filter(b.test).length,
  }));

  const birthDeathCategoryCount = Array.from(memberCounts.keys()).filter(
    isBirthDeathCategory
  ).length;

  return {
    memberCounts,
    histogram,
    birthDeathCategoryCount,
    birthDeathCategoryShare: birthDeathCategoryCount / memberCounts.size,
    birthDeathMemberShare: birthDeathMemberships / totalMemberships,
  };
}

/** FNV-1a benzeri basit, deterministik string hash (kripto değil, yalnız tohumlu seçim için). */
function seededHash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Yeni kategori kuralı (G2D): sayfanın kategorilerinden üye sayısı ≥ M
 * olanlardan birini TOHUMLU KARMA ile seçer (alfabetik DEĞİL — eski
 * kuralın "alfabetik en küçük kategoriye düşme" eğilimini kırar).
 * Hiçbir kategori eşiği geçmiyorsa DIGER döner.
 */
export function kategoriSliceV2(
  page: WorldPage,
  memberCounts: Map<string, number>,
  M: number
): string {
  const qualifying = page.categories
    .filter((c) => (memberCounts.get(c) ?? 0) >= M)
    .sort(); // kararlı indeksleme için sırala — SEÇİM hash'le yapılır, alfabetik DEĞİL
  if (qualifying.length === 0) return DIGER;
  const idx = seededHash(page.title) % qualifying.length;
  return qualifying[idx];
}
