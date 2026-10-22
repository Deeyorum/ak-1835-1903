/**
 * G4A — dakikalık hız sınırı (burst koruması).
 *
 * BİLİNEN SINIR (açıkça not edilir, sessiz bırakılmadı): bu sayaç
 * İZOLE BELLEK İÇİNDEDİR (module-scope Map), D1/KV'ye YAZILMAZ.
 * Cloudflare'in gerçek dağıtık ortamında farklı edge konumlarındaki
 * izoleler birbirinin sayacını GÖRMEZ, izole yeniden başladığında
 * sayaç sıfırlanır. Bu KASITLI bırakıldı (G4B-1'de de): dakikada
 * potansiyel 30 istek/bota kadar her istekte D1 okuma+yazması,
 * gecikmeye D1 round-trip ekler ve D1 Free'nin 100K yazma/gün
 * bütçesini hızla tüketir — burst koruması için bu ödün kabul
 * edilebilir (kaybolan bir "hız sınırı" sayacının bedeli hafif bir
 * kötüye kullanım penceresidir; kaybolan bir GÜNLÜK KOTA sayacının
 * bedeli ise botun günlük limitini tamamen aşmasıdır — bu asimetri
 * G4B-1'de günlük kotanın `kalisiKota.ts`'e, D1'e taşınmasının
 * gerekçesidir).
 */

interface SabitPencereSayaci {
  pencereBaslangici: number;
  sayac: number;
}

const HIZ_PENCERESI_MS = 60_000; // 1 dakika
const HIZ_SINIRI_PENCERE_BASINA = 30; // istek / dakika / bot

const hizSayaclari = new Map<string, SabitPencereSayaci>();

/** Bot başına basit sabit-pencere hız sınırı. Aşılırsa false döner (429). */
export function hizSinirindeMi(botId: string): boolean {
  const now = Date.now();
  const mevcut = hizSayaclari.get(botId);
  if (mevcut === undefined || now - mevcut.pencereBaslangici >= HIZ_PENCERESI_MS) {
    hizSayaclari.set(botId, { pencereBaslangici: now, sayac: 1 });
    return true;
  }
  if (mevcut.sayac >= HIZ_SINIRI_PENCERE_BASINA) return false;
  mevcut.sayac += 1;
  return true;
}
