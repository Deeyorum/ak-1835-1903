/**
 * G4B-1 — Günlük maç kotasının KALICI (D1) sürümü.
 *
 * `src/worker/hizSiniri.ts`teki bellek-içi `gunlukMacKotasindaMi`'nin
 * yerini alır. Kasıtlı olarak SADECE günlük maç kotası buraya taşındı;
 * dakikalık hız sınırı (`hizSinirindeMi`) İZOLE BELLEKTE KALDI — bkz.
 * `migrations/0001_gunluk_mac_kotasi.sql`'in üst notu (gerekçe: burst
 * koruması her istekte D1 round-trip gerektirmemeli, kota ise günde
 * bir kez artan ve kalıcı olmazsa oyunun bütünlüğünü GERÇEKTEN bozan
 * bir sayaçtır).
 *
 * Atomik artış: tek bir UPSERT ifadesi, ayrı oku+kontrol-et+yaz adımı
 * YOK (iki eşzamanlı istek arasında kaybolan güncelleme riskini
 * ortadan kaldırır — D1'in tek-yazarlı SQLite motoru bu ifadeyi
 * atomik uygular).
 */

const SORGU = `
  INSERT INTO bot_gunluk_kota (bot_id, gun, sayac) VALUES (?, ?, 1)
  ON CONFLICT(bot_id, gun) DO UPDATE SET sayac = sayac + 1
  WHERE sayac < ?
`;

function suankiGun(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/**
 * Bot başına günlük maç oluşturma kotası, D1'de kalıcı. Kota
 * aşılmışsa UPSERT'in WHERE koşulu satırı DEĞİŞTİRMEZ (`meta.changes
 * === 0`) — bu, çağırana "reddedildi" sinyalini taşır.
 */
export async function gunlukMacKotasindaMi(
  db: D1Database,
  botId: string,
  kota: number
): Promise<boolean> {
  const sonuc = await db.prepare(SORGU).bind(botId, suankiGun(), kota).run();
  return (sonuc.meta.changes ?? 0) > 0;
}

/** Sınama/gözlem amaçlı: bir botun o günkü güncel sayacı (yoksa 0). */
export async function gunlukMacSayaciniGetir(db: D1Database, botId: string): Promise<number> {
  const row = await db
    .prepare("SELECT sayac FROM bot_gunluk_kota WHERE bot_id = ? AND gun = ?")
    .bind(botId, suankiGun())
    .first();
  return row === null ? 0 : Number((row as { sayac: number }).sayac);
}
