/**
 * G4A — Giriş sınavı (SPEC §8): "Bir bot API anahtarını almadan önce
 * giriş sınavını geçer: protokol belgesini okuyup birkaç format
 * sorusunu doğru yanıtlar. Amaç insanları engellemek değil, protokolü
 * öğrenmiş bir istemciyle maça girmektir."
 *
 * BASİTLEŞTİRME (G4A, açıkça not edilir): henüz yayımlanmış bir
 * protokol belgesi (README/API belgesi) yok — bunlar G4B/G4C kapsamı.
 * Bu yüzden sorular doğrudan `src/game/types.ts`taki JSON sözleşmesinden
 * türetildi: öznel yorum gerektirmeyen, tek doğru cevabı olan format
 * soruları. Sorular/cevaplar sabittir (botlar arası RASTGELE değildir)
 * — bu, G4A'nın kapsamı dahilinde kabul edilebilir bir basitleştirme;
 * sınavı ezberlemeye karşı sertleştirme G4B/G4C'ye bırakıldı.
 */

export interface SinavSorusu {
  id: string;
  soru: string;
}

interface SinavSorusuCevapli extends SinavSorusu {
  cevap: string;
}

const SORULAR: readonly SinavSorusuCevapli[] = Object.freeze([
  {
    id: "kal-hamlesi",
    soru: "Kaçak'ın yerinde kalma hamlesinin JSON `type` alanı tam olarak nedir?",
    cevap: "kal",
  },
  {
    id: "sor-hakeme-hamlesi",
    soru: "Avcı'nın hakeme soru sorma hamlesinin JSON `type` alanı tam olarak nedir?",
    cevap: "sorHakeme",
  },
  {
    id: "yakala-hamlesi",
    soru: "Avcı'nın Kaçak'ı yakalamayı denediği hamlenin JSON `type` değeri nedir?",
    cevap: "yakala",
  },
  {
    id: "en-cok-uzmanlik",
    soru: "Bir bot maça katılırken en çok kaç uzmanlık beyan edebilir?",
    cevap: "2",
  },
  {
    id: "yanlis-yakalama",
    soru: "Yanlış bir 'yakala' denemesi turu harcar mı? (evet/hayır)",
    cevap: "evet",
  },
]);

/** Botlara gösterilecek soru listesi (cevaplar olmadan). */
export function sinavSorulariniGetir(): SinavSorusu[] {
  return SORULAR.map(({ id, soru }) => ({ id, soru }));
}

function normallestir(s: string): string {
  return s.trim().toLocaleLowerCase("en");
}

/**
 * Gönderilen cevapları kontrol eder. Tüm sorular doğru yanıtlanmalıdır
 * (kısmi geçiş yok — SPEC: "protokolü öğrenmiş bir istemci" eşiği).
 */
export function sinaviDegerlendir(
  cevaplar: Record<string, string>
): { gecti: boolean; yanlisSoruIdleri: string[] } {
  const yanlis: string[] = [];
  for (const s of SORULAR) {
    const verilen = cevaplar[s.id];
    if (verilen === undefined || normallestir(verilen) !== normallestir(s.cevap)) {
      yanlis.push(s.id);
    }
  }
  return { gecti: yanlis.length === 0, yanlisSoruIdleri: yanlis };
}
