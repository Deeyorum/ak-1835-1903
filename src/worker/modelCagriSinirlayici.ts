import type { HakemKanali } from "../game/hakemKanali";
import type { Role } from "../game/types";

/**
 * Madde 4 (G4B-1b) — maç başına model çağrısı üst sınırı.
 *
 * G4B-1'de "model" hâlâ sahte/senkrondur (gerçek `env.AI` G4B-2'nin
 * işi) — bu sınır İLERİYE DÖNÜK bir güvenlik ağıdır: gerçek bir model
 * bağlandığında (G4B-2), bir maçın KONTROLSÜZCE yüzlerce çağrı
 * tüketmesini (maliyet/nöron bütçesi) önler. `HakemKanali`'nin AYNI
 * arayüzünü (`mesajGonder`) sağlayan bir SARMALAYICI'dır — src/game'e
 * (Madde 2 dışında) dokunmadan, Worker katmanında devre dışı bırakılır.
 *
 * Sınır aşıldığında: sabit yanıt döner (gerçek hakem/model ÇAĞRILMAZ —
 * "çağrı" zaten burada önlenir), maç DÜŞMEZ (durum/tur etkilenmez),
 * olay `asimlar` listesine eklenir — çağıran (`maclar.ts`) bunu
 * `logEntry.rejected`'e (zaten var olan, serbest-metin nedenli genel
 * reddetme mekanizması) EKLER; bu TÜRÜ (`TurnLogEntry.rejected`)
 * DEĞİŞTİRMEZ, src/game/types.ts'e dokunmadan çalışır.
 */

export const VARSAYILAN_MAC_MODEL_CAGRI_SINIRI = 40;

/** Çıkış süzgecinin `SABIT_RED_YANITI`siyle AYNI metni KASITLI OLARAK
 * kullanmaz — bu iki durum SEMANTİK OLARAK farklıdır (biri bilgi
 * sızıntısı reddi, diğeri kaynak/bütçe sınırı) ve ayrı izlenebilmeli. */
export const MODEL_CAGRI_SINIRI_SABIT_YANITI =
  "Bu maçta model çağrısı sınırına ulaşıldı, yanıt verilemiyor.";

export interface ModelCagriAsimOlayi {
  role: Role;
  reason: string;
}

export interface ModelCagriSinirliKanalSonucu {
  kanal: HakemKanali;
  /** Çağrı bittiğinde (processTurn sonrası) okunur — bu turda sınır
   * aşımı olduysa `logEntry.rejected`'e eklenmek üzere. */
  asimlar: ModelCagriAsimOlayi[];
}

/**
 * `temelKanal`'ı sarmalar: `gecmisCagriSayisi` (bu maçın ÖNCEKİ
 * turlarında zaten yapılmış toplam hakem-mesajı sayısı, bkz.
 * `MatchState.log[].hakemMesajlari.length` toplamı) + bu çağrı
 * BOYUNCA yapılan YENİ çağrılar `sinir`'i aşarsa, `temelKanal`
 * HİÇ ÇAĞRILMAZ (gerçek/ileride gerçek olacak model maliyeti
 * ÖNLENİR) ve sabit yanıt döner.
 */
export function modelCagriSinirliKanalOlustur(
  temelKanal: HakemKanali,
  gecmisCagriSayisi: number,
  sinir: number
): ModelCagriSinirliKanalSonucu {
  let sayac = gecmisCagriSayisi;
  const asimlar: ModelCagriAsimOlayi[] = [];

  const kanal: HakemKanali = {
    mesajGonder(gonderen, mesaj, hakemId) {
      if (sayac >= sinir) {
        asimlar.push({
          role: gonderen,
          reason: `Model çağrısı sınırı aşıldı (sınır=${sinir}).`,
        });
        return MODEL_CAGRI_SINIRI_SABIT_YANITI;
      }
      sayac += 1;
      return temelKanal.mesajGonder(gonderen, mesaj, hakemId);
    },
  };

  return { kanal, asimlar };
}
