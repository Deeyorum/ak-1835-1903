import type { MatchState, Role, SuzgecOlayi } from "./types";
import type { WorldData } from "./world";
import {
  TUM_DILIM_TURLERI,
  dilimUret,
  type Dilim,
  type DilimBaglami,
  type DilimTuru,
} from "./hakemDilim";
import { hakemBul, type HakemAtamasi, type HakemPaneli } from "./hakemPanel";
import {
  GUVENILMEYEN_METIN_SINIRI,
  modelGirdisiKur,
  type HakemModeli,
  type KonusmaSatiri,
} from "./hakemModel";
import { SABIT_RED_YANITI, suz } from "./hakemSuzgec";

// --------------------------------------- C: Untrusted text contract
//
// Bir bota/hakeme ulaşan KARŞI TARAF serbest metni (hakem yanıtı, ya da
// G4B-1'de gerçek bir modelin kendi girdisinde göreceği Avcı/Kaçak
// mesajları), tur başına sunucunun ürettiği rastgele bir ETİKETLE
// sarılı gelir. Etiket riski AZALTIR, ORTADAN KALDIRMAZ — bkz. SPEC
// "Untrusted text contract" ve docs/katilim-rehberi.md.

/** Sarma biçiminde içerik kesildiğinde eklenen görünür işaret. */
const KESILME_ISARETI = "[KESILDI]";

const ETIKET_ALFABESI = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
const ETIKET_UZUNLUGU = 10;

/**
 * SEED-C — Tur başına (maç tohumu, tur numarası) çiftinden VE bir
 * SUNUCU SIRRINDAN HMAC-SHA-256 (Web Crypto) ile türetilen, tahmin
 * edilemeyen etiket. Aynı turda birden çok hakem mesajı gönderilse de
 * (round-robin) HEPSİ aynı etiketi kullanır — "tur başına yenilenir"
 * talimatı budur, mesaj başına değil.
 *
 * **Neden sır (eski sürüm yalnız seed+turn kullanıyordu):** `seed`,
 * biten bir maçta `GET /matches/{id}/record` yanıtında AÇIKÇA veriliyor
 * (SPEC §7b/§7c, ACIK_ISLER.md'deki seed bulgusu) — etiketin
 * "tahmin edilemezliği" SEED'İN GİZLİ KALMASINA bağımlı kalırsa, bu
 * güvence kendi kendini çözer. Sır (`ETIKET_SIRRI`) hiçbir API
 * yanıtına YAZILMAZ; etiket artık seed açılsa bile sır olmadan
 * YENİDEN ÜRETİLEMEZ.
 *
 * **FAIL CLOSED:** `sir` tanımsız ya da boş dizgeyse SESSİZCE
 * seed-yalnız üretime DÜŞÜLMEZ — açık bir hata fırlatılır.
 *
 * **Neden ASYNC (mimari not, DEFTER.md'de ayrıntılı):** Web Crypto'nun
 * HMAC işlemleri (`crypto.subtle`) HER ZAMAN asenkrondur; motor
 * (`processTurn`/`mesajGonder`) ise KASITLI OLARAK senkron kalır (bkz.
 * `src/worker/hakemKopru.ts`'teki "motor SENKRON ve SAF kalır" kararı).
 * Bu fonksiyon bu yüzden `mesajGonder` İÇİNDEN ÇAĞRILMAZ — ÇAĞIRAN
 * (worker katmanı, `maclar.ts`) turun BAŞINDA BİR KEZ `await` eder ve
 * sonucu `PanelKanaliSecenekleri.turEtiketi` olarak düz bir dizge
 * hâlinde geçirir — aynen gerçek model çağrısı için zaten var olan
 * "ön geçiş" deseni (`hakemKopru.ts`) gibi.
 */
/**
 * `sir` değerine göre içe aktarılmış HMAC anahtarını ÖNBELLEKTE tutar.
 * Her çağrıda `crypto.subtle.importKey` tekrarlamak (a) gereksiz CPU
 * harcar, (b) yerel `wrangler dev`de (workerd) hızlı ardışık isteklerde
 * KARARSIZLIK gözlendi (bkz. DEFTER.md "SEED-C" — tekrar eden
 * `importKey` çağrıları altında bağlantı aniden kapanıyordu; anahtar
 * önbelleklenince sorun gözlenmedi). Sır tek bir dağıtım ömrü boyunca
 * SABİTTİR, bu yüzden önbellek güvenlidir.
 */
const anahtarOnbellegi = new Map<string, Promise<CryptoKey>>();

function hmacAnahtariniAl(sir: string): Promise<CryptoKey> {
  let anahtar = anahtarOnbellegi.get(sir);
  if (anahtar === undefined) {
    anahtar = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(sir),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    anahtarOnbellegi.set(sir, anahtar);
  }
  return anahtar;
}

export async function turEtiketiUret(
  seed: number,
  turn: number,
  sir: string | undefined
): Promise<string> {
  if (sir === undefined || sir.length === 0) {
    throw new Error(
      "turEtiketiUret: ETIKET_SIRRI tanımsız ya da boş — etiket sır olmadan ÜRETİLEMEZ (fail closed)."
    );
  }
  const anahtar = await hmacAnahtariniAl(sir);
  const veri = new TextEncoder().encode(`${seed}:${turn}`);
  const imza = new Uint8Array(await crypto.subtle.sign("HMAC", anahtar, veri));
  let sonuc = "";
  for (let i = 0; i < ETIKET_UZUNLUGU; i++) {
    sonuc += ETIKET_ALFABESI[imza[i] % ETIKET_ALFABESI.length];
  }
  return sonuc;
}

function regexKacisi(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Etiketin KENDİSİNİN metin içinde geçen örneklerini siler — büyük/
 * küçük harf VE harfler arasına serpiştirilmiş boşluk varyantları
 * dahil (goal'ün açık talimatı: bir hakem/model kendi bağlamında
 * gördüğü etiketi öğrenip sarmalayıcıyı erken "kapatmaya" çalışabilir
 * — "etiket kapatma denemesi"). Sarılmadan ÖNCE, sınırlamadan ÖNCE
 * uygulanır.
 */
export function etiketiTemizle(metin: string, etiket: string): string {
  if (etiket.length === 0) return metin;
  const desen = [...etiket].map(regexKacisi).join("\\s*");
  return metin.replace(new RegExp(desen, "gi"), "");
}

function unicodeUzunluk(s: string): number {
  return [...s].length;
}

/** `mesaj`/`yanit` için ortak Unicode uzunluk kontrolü (maclar.ts da kullanır). */
export function metinSiniriAsiyorMu(
  metin: string,
  sinir: number = GUVENILMEYEN_METIN_SINIRI
): boolean {
  return unicodeUzunluk(metin) > sinir;
}

/**
 * Etiket temizliğinden SONRA uygulanır. Aşarsa Unicode kod noktası
 * sınırına keser ve görünür bir işaret ekler — "kesilsin ve kesildiği
 * işaretlensin" talimatı.
 */
export function sinirlaVeIsaretle(
  metin: string,
  sinir: number = GUVENILMEYEN_METIN_SINIRI
): { metin: string; kesildiMi: boolean } {
  const noktalar = [...metin];
  if (noktalar.length <= sinir) return { metin, kesildiMi: false };
  return { metin: noktalar.slice(0, sinir).join("") + KESILME_ISARETI, kesildiMi: true };
}

/** Son adım: temizlenmiş + sınırlanmış metni o turun etiketiyle sarar. */
export function etiketleSar(metin: string, etiket: string): string {
  return `<<${etiket}>>${metin}<<${etiket}>>`;
}

/**
 * `etiketleSar`'ın tersi — bir bota/hakeme ulaşan sarılı metinden
 * etiket değerini ve (varsa) kesilme işaretini ayıklar. Biçim dışı
 * (sarılmamış) bir girdide GÜVENLİ DÜŞÜŞ: etiket `""`, içerik aynen,
 * kesildiMi `false` döner — eski/stub kanallardan gelen sarılmamış
 * dizgeler için (bkz. `createStubHakemKanali`, test mock'ları).
 */
export function sariliMetniAyristir(sarili: string): {
  etiket: string;
  icerik: string;
  kesildiMi: boolean;
} {
  const esleme = /^<<([^<>]+)>>([\s\S]*)<<\1>>$/.exec(sarili);
  if (esleme === null) {
    return { etiket: "", icerik: sarili, kesildiMi: false };
  }
  const etiket = esleme[1];
  let icerik = esleme[2];
  let kesildiMi = false;
  if (icerik.endsWith(KESILME_ISARETI)) {
    kesildiMi = true;
    icerik = icerik.slice(0, icerik.length - KESILME_ISARETI.length);
  }
  return { etiket, icerik, kesildiMi };
}

/**
 * Hakem iletişim arayüzü. G2'de yalnız bu arayüz + sabit yanıtlı stub
 * mevcuttu. G3'te `hakemId` parametresi EKLENDİ (opsiyonel — mevcut
 * stub'lar ve ölçüm harness'leri değişmeden bu arayüzü sağlamaya
 * devam eder; verilmezse mesaj sistem hakemine gider).
 */
export interface HakemKanali {
  mesajGonder(gonderen: Role, mesaj: string, hakemId?: string): string;
}

const SABIT_YANIT =
  "Bu konuda bilgi veremem.";

/** Kullanıcı hakemi pencere içinde yanıt yazmazsa dönen sabit yanıt (SPEC §7: "pas"). */
export const SABIT_ZAMAN_ASIMI_YANITI = "Hakem zamanında yanıt vermedi.";

/** G2 stub: her mesaja aynı sabit, bilgi sızdırmayan yanıtı döner. */
export function createStubHakemKanali(): HakemKanali {
  return {
    mesajGonder(_gonderen: Role, _mesaj: string): string {
      return SABIT_YANIT;
    },
  };
}

// ------------------------------------------- kullanıcı hakemi kanalı

export interface KullaniciHakemMesaji {
  mesajId: string;
  hakemId: string;
  turn: number;
  gonderen: Role;
  metin: string;
  /**
   * Hakemin O TURDAKİ kendi dilimi. SPEC §6: "Kullanıcı hakemleri
   * dilimlerini ve mesajları API'den alır" — dilim gelen kutusuyla
   * birlikte teslim edilir, çünkü kullanıcı hakemi dış bir aktördür ve
   * dilimi başka hiçbir yoldan öğrenemez. Sistem hakeminin bağlamıyla
   * aynı sınır: yalnız KENDİ dilimi.
   */
  dilim: Dilim;
}

/**
 * G3 Madde 3 — kullanıcı hakemi gelen/yanıt kutusu soyutlaması.
 *
 * Ağ YOK: kullanıcı hakemi, mesajları gelen kutusundan okuyan ve
 * yanıtları yanıt kutusuna yazan bir dış aktördür (G4'te HTTP API).
 * Motor açısından tek önemli nokta, yanıt kutusu BOŞ kaldığında (yani
 * hakem pencere içinde yazmadığında) sabit zaman aşımı yanıtının
 * kullanılmasıdır.
 */
export interface KullaniciHakemKanali {
  /** Hakemin henüz yanıtlamadığı mesajları. */
  gelenKutusu(hakemId: string): readonly KullaniciHakemMesaji[];
  mesajBirak(mesaj: KullaniciHakemMesaji): void;
  yanitYaz(mesajId: string, metin: string): void;
  /** Yanıt yazılmadıysa undefined — çağıran zaman aşımı uygular. */
  yanitOku(mesajId: string): string | undefined;
}

export interface BellekKanaliSecenekleri {
  /**
   * Pencere içinde yanıt veren bir kullanıcı hakemini taklit eder.
   * `undefined` dönerse hakem suskun kalmış sayılır (zaman aşımı).
   */
  otoYanit?: (mesaj: KullaniciHakemMesaji) => string | undefined;
}

export function createBellekKullaniciKanali(
  secenekler: BellekKanaliSecenekleri = {}
): KullaniciHakemKanali {
  const gelen = new Map<string, KullaniciHakemMesaji[]>();
  const yanitlar = new Map<string, string>();

  return {
    gelenKutusu(hakemId: string): readonly KullaniciHakemMesaji[] {
      return (gelen.get(hakemId) ?? []).filter((m) => !yanitlar.has(m.mesajId));
    },
    mesajBirak(mesaj: KullaniciHakemMesaji): void {
      const kutu = gelen.get(mesaj.hakemId);
      if (kutu === undefined) gelen.set(mesaj.hakemId, [mesaj]);
      else kutu.push(mesaj);

      const oto = secenekler.otoYanit;
      if (oto !== undefined) {
        const y = oto(mesaj);
        if (y !== undefined) yanitlar.set(mesaj.mesajId, y);
      }
    },
    yanitYaz(mesajId: string, metin: string): void {
      yanitlar.set(mesajId, metin);
    },
    yanitOku(mesajId: string): string | undefined {
      return yanitlar.get(mesajId);
    },
  };
}

// ------------------------------------------------------- panel kanalı

export interface PanelKanaliSecenekleri {
  world: WorldData;
  getState: () => MatchState;
  panel: HakemPaneli;
  dilimBaglami: DilimBaglami;
  /** Sistem hakeminin modeli (G4'te Workers AI; testte sahte model). */
  sistemModeli: HakemModeli;
  kullaniciKanali?: KullaniciHakemKanali;
  /** Süzgeç bir yanıtı engellediğinde çağrılır (maç kaydına yazma). */
  olayYaz?: (olay: SuzgecOlayi) => void;
  /**
   * SEED-C — bu turun önceden (ÇAĞIRAN tarafından, `turEtiketiUret`
   * ile `await`lenerek) hesaplanmış etiketi. ZORUNLU alan — varsayılan
   * YOK (fail closed): kanalı kuran taraf sırrı ÖNCEDEN çözmek ve
   * etiketi hesaplamak ZORUNDADIR, aksi hâlde bu dosya hiç derlenmez.
   */
  turEtiketi: string;
}

export interface PanelKanali extends HakemKanali {
  /** Hakem başına konuşma geçmişi (yalnız o hakemin gördüğü satırlar). */
  konusma(hakemId: string): readonly KonusmaSatiri[];
}

/**
 * Panelin tamamını tek bir HakemKanali olarak sunar.
 *
 * Her mesaj için akış: (1) hakemin KENDİ dilimi gerçek durumdan
 * üretilir, (2) sistem hakemi için bağlam YALNIZ bu dilim + bu hakemin
 * konuşmasıyla kurulur, (3) model/kullanıcı yanıtı alınır, (4) yanıt
 * çıkış süzgecinden geçer, (5) engellenirse sabit metin döner ve olay
 * maç kaydına yazılır.
 *
 * Adım (4) kullanıcı hakemlerinin yanıtlarına da uygulanır — asıl
 * tehdit zaten kötü niyetli bir kullanıcı hakemidir.
 */
export function createPanelKanali(secenekler: PanelKanaliSecenekleri): PanelKanali {
  const { world, getState, panel, dilimBaglami, sistemModeli, turEtiketi } = secenekler;
  const konusmalar = new Map<string, KonusmaSatiri[]>();
  let mesajSayaci = 0;

  function konusmaAl(hakemId: string): KonusmaSatiri[] {
    const mevcut = konusmalar.get(hakemId);
    if (mevcut !== undefined) return mevcut;
    const yeni: KonusmaSatiri[] = [];
    konusmalar.set(hakemId, yeni);
    return yeni;
  }

  /** Bu hakemin bilmediği dilim türlerinin o turdaki değerleri. */
  function digerDilimDegerleri(state: MatchState, kendiTuru: DilimTuru): string[] {
    const degerler: string[] = [];
    for (const tur of TUM_DILIM_TURLERI) {
      if (tur === kendiTuru) continue;
      degerler.push(dilimUret(world, state, tur, dilimBaglami).deger);
    }
    return degerler;
  }

  function hamYanit(
    hakem: HakemAtamasi,
    dilim: Dilim,
    gonderen: Role,
    mesaj: string,
    state: MatchState,
    etiket: string
  ): string {
    if (hakem.tur === "sistem") {
      const konusma = konusmaAl(hakem.id);
      // Bağlam burada kurulur: SADECE kendi dilimi + bu konuşma. Etiket
      // iletilir ki (gerçek bir model adaptörü takıldığında) Avcı/Kaçak
      // bölümleri ayrı, etiketli sunulabilsin (bkz. ModelGirdisi notu).
      return sistemModeli(modelGirdisiKur(dilim, konusma, etiket));
    }

    const kanal = secenekler.kullaniciKanali;
    if (kanal === undefined) return SABIT_ZAMAN_ASIMI_YANITI;

    mesajSayaci += 1;
    const mesajId = `${hakem.id}#${mesajSayaci}`;
    kanal.mesajBirak({
      mesajId,
      hakemId: hakem.id,
      turn: state.turn,
      gonderen,
      metin: mesaj,
      dilim,
    });
    const yanit = kanal.yanitOku(mesajId);
    return yanit === undefined ? SABIT_ZAMAN_ASIMI_YANITI : yanit;
  }

  return {
    konusma(hakemId: string): readonly KonusmaSatiri[] {
      return konusmaAl(hakemId);
    },

    mesajGonder(gonderen: Role, mesaj: string, hakemId?: string): string {
      const state = getState();
      // Tur başına TEK etiket: bu turda (round-robin ile) birden çok
      // hakem mesajı gönderilse de hepsi AYNI etiketi kullanır. Değer
      // ÇAĞIRAN tarafından önceden `turEtiketiUret` ile (await'lenerek)
      // hesaplanmıştır — bu fonksiyon SENKRON kalmak zorunda olduğu
      // için burada TEKRAR hesaplanamaz (bkz. `turEtiketiUret` notu).
      const etiket = turEtiketi;

      const hedefId = hakemId ?? panel.sistemHakemi.id;
      const hakem = hakemBul(panel, hedefId);
      if (hakem === undefined) {
        // Bilinmeyen hakem: bilgi vermeden reddet (hangi id'lerin geçerli
        // olduğu da bir sinyaldir). Yine de sarılı döner — sözleşme
        // HER `mesajGonder` çıktısı için tek biçimlidir.
        return etiketleSar(SABIT_RED_YANITI, etiket);
      }

      const konusma = konusmaAl(hakem.id);
      konusma.push({ gonderen, metin: mesaj });

      const dilim = dilimUret(world, state, hakem.dilimTuru, dilimBaglami);
      const ham = hamYanit(hakem, dilim, gonderen, mesaj, state, etiket);

      /**
       * Sayfa bulunamazsa SESSİZCE devam EDİLMEZ: `page?.pageId`
       * yazmak, bir dünya-verisi tutarsızlığında sayfa kimliği
       * korumasını fark edilmeden kapatırdı. Bu güvenlik açısından
       * anlamlı bir sessiz bozulma olur — gürültülü başarısızlık
       * tercih edildi.
       */
      const page = world.pages.get(state.kacakPosition);
      if (page === undefined) {
        throw new Error(
          `createPanelKanali: Kaçak konumu dünyada yok (${state.kacakPosition}) — süzgeç sayfa kimliğini koruyamaz.`
        );
      }

      const sonuc = suz(ham, {
        gercekBaslik: state.kacakPosition,
        sayfaKimligi: page.pageId,
        izinliDeger: dilim.deger,
        digerDilimDegerleri: digerDilimDegerleri(state, hakem.dilimTuru),
      });

      if (sonuc.engellendi) {
        const olayYaz = secenekler.olayYaz;
        if (olayYaz !== undefined && sonuc.sebep !== undefined && sonuc.varyant !== undefined) {
          olayYaz({
            turn: state.turn,
            hakemId: hakem.id,
            sebep: sonuc.sebep,
            varyant: sonuc.varyant,
          });
        }
      }

      // İç konuşma geçmişi (modelin kendi sonraki-tur bağlamı) SARILMAMIŞ
      // hâliyle tutulur — sarma/kesme yalnız DIŞARI dönen değere uygulanır.
      konusma.push({ gonderen: "hakem", metin: sonuc.metin });

      // C: Untrusted text contract — sar(sınırla(temizle(süzülmüş metin))).
      const temizlenmis = etiketiTemizle(sonuc.metin, etiket);
      const { metin: sinirlanmis } = sinirlaVeIsaretle(temizlenmis);
      return etiketleSar(sinirlanmis, etiket);
    },
  };
}
