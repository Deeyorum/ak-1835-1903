/**
 * G4C-4a-FIX (madde 2) — `POST /bots` için günlük (UTC) kayıt tavanı.
 *
 * `kalisiKota.ts`teki maç kotasının atomik UPSERT deseninin AKSİNE,
 * burada sayım yalnız OKUMA (`SELECT COUNT`) — goal'ün açık talimatı.
 * Bu, çok kısa bir yarış penceresi (TOCTOU) bırakır: iki eşzamanlı
 * kayıt isteği tavanın SINIRINDA ikisi de "altında" görüp ikisi de
 * yazabilir. Kasıtlı kabul edilen bir ödün (bkz. ACIK_ISLER.md ÖNERİ,
 * G4C-4a-FIX) — atomik hale getirme bu goal'in kapsamı DIŞINDA.
 */

/** Günlük bot kayıt tavanı — koda gömülü sabit (wrangler.toml'dan GELMEZ). */
export const GUNLUK_BOT_KAYIT_TAVANI = 200;

function suankiGunUtc(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** O UTC günü kayıtlı (`bots.created_at`) bot sayısı. Yalnız okur, yazmaz. */
export async function gunlukBotKayitSayisi(
  db: D1Database,
  gun: string = suankiGunUtc()
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as sayac FROM bots WHERE substr(created_at, 1, 10) = ?")
    .bind(gun)
    .first();
  return row === null ? 0 : Number((row as { sayac: number }).sayac);
}

/** Şu andan UTC gün sonuna (00:00 UTC) kalan saniye — `Retry-After` için. */
export function saniyeGunSonunaKadarUtc(): number {
  const simdi = new Date();
  const gunSonu = Date.UTC(
    simdi.getUTCFullYear(),
    simdi.getUTCMonth(),
    simdi.getUTCDate() + 1,
    0,
    0,
    0
  );
  return Math.max(1, Math.ceil((gunSonu - simdi.getTime()) / 1000));
}
