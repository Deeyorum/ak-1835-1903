export function jsonYanit(gövde: unknown, status = 200, ekBasliklar?: Record<string, string>): Response {
  return new Response(JSON.stringify(gövde), {
    status,
    headers: { "Content-Type": "application/json", ...ekBasliklar },
  });
}

export function hataYaniti(status: number, mesaj: string, ekBasliklar?: Record<string, string>): Response {
  return jsonYanit({ hata: mesaj }, status, ekBasliklar);
}

/**
 * İstek gövdesi bayt üst sınırı (ÖNERİ/goal: "istek boyutu üst sınırı").
 *
 * Türetme: en büyük meşru `/matches/{id}/move` gövdesi — `move.mesaj` +
 * `move.hakemId` + `hakemMesajlari` dizisi (en fazla `MAX_PANEL`=10 öğe,
 * her öğede `mesaj`+`hakemId`) = 2 × (10+1) = 22 metin alanı. Her alan en
 * kötü durumda `GUVENILMEYEN_METIN_SINIRI`=500 Unicode kod noktası × 4
 * bayt (UTF-8'de çok baytlı bir kod noktasının üst sınırı) = 2000 bayt.
 * 22 × 2000 = 44000 bayt; ölçülen gerçek JSON (anahtar adları, parantez,
 * virgül dahil) 44332 bayt (bkz. DEFTER.md kaydı) — 1024 baytlık pay ile
 * 45056 bayta (44 KiB) yuvarlandı. `hakemId`'nin kendisi şu an bu uzunlukta
 * doğrulanmıyor (ayrı bir sınır yok); bu sayı yalnız gövde büyüklüğü için
 * bir ÜST SINIR, alan bazlı doğrulamanın yerine geçmez.
 */
export const ISTEK_GOVDESI_BAYT_SINIRI = 45056;

export type GovdeSonucu<T> = { tamam: true; govde: T } | { tamam: false; yanit: Response };

/**
 * İstek gövdesini JSON olarak ayrıştırır. Ayrıştırmadan ÖNCE boyut
 * kontrolü yapılır (hem `Content-Length` başlığı hem de gerçek okunan
 * bayt sayısı) — aşımda JSON hiç ayrıştırılmaz, 413 döner. Çağıran
 * `if (!sonuc.tamam) return sonuc.yanit;` deseniyle (bkz. maclar.ts
 * `macVeRolDogrula`) kullanır.
 */
export async function govdeyiAyristir<T>(request: Request): Promise<GovdeSonucu<T>> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > ISTEK_GOVDESI_BAYT_SINIRI) {
    return {
      tamam: false,
      yanit: hataYaniti(413, `İstek gövdesi ${ISTEK_GOVDESI_BAYT_SINIRI} baytı aşamaz.`),
    };
  }
  const metin = await request.text();
  if (new TextEncoder().encode(metin).length > ISTEK_GOVDESI_BAYT_SINIRI) {
    return {
      tamam: false,
      yanit: hataYaniti(413, `İstek gövdesi ${ISTEK_GOVDESI_BAYT_SINIRI} baytı aşamaz.`),
    };
  }
  try {
    return { tamam: true, govde: JSON.parse(metin) as T };
  } catch {
    return { tamam: false, yanit: hataYaniti(400, "Geçersiz JSON gövdesi.") };
  }
}
