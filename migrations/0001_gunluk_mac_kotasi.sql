-- Migration number: 0001 	 2026-10-18T10:07:38.170Z
--
-- G4B-1 — bot başına GÜNLÜK MAÇ KOTASINI kalıcı hâle getirir.
--
-- Kasıtlı kapsam: `src/worker/hizSiniri.ts`teki İKİ sayaçtan yalnız
-- günlük maç kotası (`gunlukMacKotasindaMi`) buraya taşınıyor. Dakikalık
-- hız sınırı (`hizSinirindeMi`, bot başına 30 istek/dk — burst koruması)
-- İZOLE BELLEKTE KALIYOR: her istekte D1'e okuma+yazma yapmak (dakikada
-- potansiyel 30 kez/bot) D1 Free'nin yazma bütçesini (100K/gün) hızla
-- tüketir ve istek gecikmesine D1 round-trip ekler; kota ise günde bir
-- kez artan, kaybolması/sıfırlanması oyunun bütünlüğünü GERÇEKTEN
-- bozan bir sayaçtır (bir bot izole yeniden başladığında günlük limitini
-- aşabilir) — bu asimetri yüzünden ikisi AYRI tutuldu.
--
-- Atomik artış: UPSERT'in WHERE koşulu kotayı aşan isteği SESSİZCE
-- reddeder (satır değişmez, `meta.changes === 0`); çağıran bunu kontrol
-- eder (bkz. src/worker/kalisiHizSiniri.ts).
CREATE TABLE bot_gunluk_kota (
  bot_id TEXT NOT NULL,
  gun TEXT NOT NULL, -- YYYY-MM-DD (UTC)
  sayac INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, gun)
);

