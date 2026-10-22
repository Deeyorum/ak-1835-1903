import type { AvciMove, MatchState, Role, Specialization } from "../game/types";
import type { WorldData } from "../game/world";
import type { EkHakemMesaji } from "../game/engine";
import { dilimUret, type DilimBaglami } from "../game/hakemDilim";
import { hakemBul, type HakemPaneli } from "../game/hakemPanel";
import {
  modelGirdisiKur,
  type HakemModeli,
  type KonusmaSatiri,
} from "../game/hakemModel";
import type { KullaniciHakemMesaji } from "../game/hakemKanali";
import { workersAiModeliCagir, type EnvAiRunlayici } from "./workersAiHakemi";
import { avciHakemKotasi } from "./hakemleri";

/**
 * G4B-2a Madde 1 — MODEL KÖPRÜSÜ, **(b) YOLU**.
 *
 * SORUN (G4B-1'den beri açık, bkz. ACIK_ISLER.md "asenkron köprü"):
 * `HakemModeli` SENKRONDUR (`(girdi) => string`), gerçek
 * `env.AI.run()` ASENKRONDUR (`Promise`). İki uç birleştirilemez.
 *
 * SEÇİLEN YOL (b, DeeOne'ın ÖNERİSİ): motor SENKRON ve SAF kalır;
 * `processTurn()`'ün G2'den beri sabit sözleşmesine DOKUNULMAZ
 * (src/game hiç DEĞİŞMEZ). Worker katmanı, `processTurn()`
 * ÇAĞRILMADAN ÖNCE o turda motorun hakem kanalını çağıracağı HER
 * mesaj için model girdisini kurar, `await` ile gerçek modeli çağırır
 * ve HAZIR yanıtları, `HakemModeli` arayüzünü SENKRON uygulayan
 * "önceden hesaplanmış" bir modelle motora verir.
 *
 * NEDEN (a) DEĞİL: (a) `processTurn()`/`hakemKanali.ts`/Worker
 * rotalarını asenkron hale getirmeyi gerektiriyordu — canlı motora
 * dokunan, G2'den beri birçok testin dayandığı saf/senkron sözleşmeyi
 * bozan geniş bir değişiklik. (b) ile asenkron "sızıntı" src/game'e
 * hiç GİRMEZ.
 *
 * SÜZGEÇ: **YERİNDE KALIR.** Bu modül modelin HAM metnini döndürür;
 * `createPanelKanali` o metni mevcut `suz()`'den geçirir (süzgeç
 * taşınmadı, kopyalanmadı, gevşetilmedi). Bu modül `hakemSuzgec.ts`'i
 * hiç içe aktarmaz.
 *
 * BİLİNEN DAVRANIŞ FARKI (Madde 0'da bildirildi): sistem hakeminin
 * BİRİKEN konuşmasına motor SÜZÜLMÜŞ yanıtı yazar
 * (`hakemKanali.ts`'teki `konusma.push({ gonderen: "hakem", ... })`).
 * Ön geçiş süzgeci çağıramayacağı (kopyalama yasağı) için konuşmayı
 * HAM yanıtla kurar. Fark YALNIZ "aynı tura, aynı SİSTEM hakemine
 * ikinci mesaj" durumunda görünür (Arabulucu + iki mesaj da sisteme).
 * Güvenlik etkisi YOK: o metni modelin KENDİSİ üretti (bağlamına yeni
 * bir sır girmez) ve nihai yanıt yine `suz()`'den geçer. Eşleştirme
 * İÇERİK anahtarına DEĞİL, (hakemId, sıra) anahtarına dayandığı için
 * bu fark sessiz bir kayba yol açmaz.
 */

export type HakemModu = "sahte" | "workersAi";

export const VARSAYILAN_HAKEM_MODU: HakemModu = "sahte";

/**
 * Önceden hesaplanmış yanıt BULUNAMAYAN bir çağrıda dönen sabit metin.
 *
 * Süzgecin `SABIT_RED_YANITI`si ve çağrı sınırının sabit yanıtı ile
 * KASITLI OLARAK aynı değil: üçü SEMANTİK OLARAK farklı durumlardır
 * (bilgi sızıntısı reddi / bütçe sınırı / köprü eşleşmesi tutmadı) ve
 * ayrı ayrı izlenebilmeli (aynı gerekçe `modelCagriSinirlayici.ts`'te).
 * İçeriği bilgi SIZDIRMAZ.
 */
export const KOPRU_EKSIK_YANIT = "Hakem şu an yanıt veremiyor.";

/**
 * `env.HAKEM_MODU`'nu çözer. TANINMAYAN bir değer SESSİZCE "sahte"ye
 * DÜŞMEZ — bu, gerçek modelin bağlı olduğu sanılırken sahte modelle
 * ölçüm yapılmasına yol açardı (sessiz bozulma). Yapılandırma hatası
 * GÜRÜLTÜLÜ başarısız olur.
 */
export function hakemModunuCoz(ham: string | undefined): HakemModu {
  if (ham === undefined || ham === "") return VARSAYILAN_HAKEM_MODU;
  if (ham === "sahte" || ham === "workersAi") return ham;
  throw new Error(
    `hakemModunuCoz: tanınmayan HAKEM_MODU "${ham}" — yalnız "sahte" veya "workersAi".`
  );
}

// ------------------------------------- turun hakem mesajları (sıralı)

/** Motorun bu turda hakem kanalına vereceği tek bir mesaj. */
export interface TurdakiHakemMesaji {
  gonderen: Role;
  mesaj: string;
  /** Çözülmemiş hâli — `undefined` ise sistem hakemine gider. */
  hakemId: string | undefined;
}

export interface TurdakiMesajGirdileri {
  avciMove: AvciMove;
  avciHakemMesajlari: readonly EkHakemMesaji[] | undefined;
  /** Ek mesajların varsayılan hedefi (`maclar.ts` vermiyor ⇒ sistem). */
  avciHakemId?: string;
  avciSpecializations: readonly Specialization[];
  /**
   * `processTurn` bu kanalı DA çağırır ama Worker ONU BAĞLAMAZ
   * (`maclar.ts` yalnız `avciHakemMesajlari` geçirir). Köprünün
   * motordan SESSİZCE KAYMASINI önlemek için burada açıkça alınır ve
   * boş değilse HATA verilir — birisi ileride Kaçak kanalını API'ye
   * bağlarsa köprüyü de güncellemek ZORUNDA kalır.
   */
  kacakHakemMesajlari?: readonly EkHakemMesaji[];
}

function cozEkMesaj(m: EkHakemMesaji, varsayilan: string | undefined): TurdakiHakemMesaji {
  if (typeof m === "string") return { gonderen: "avci", mesaj: m, hakemId: varsayilan };
  return { gonderen: "avci", mesaj: m.mesaj, hakemId: m.hakemId ?? varsayilan };
}

/**
 * Motorun hakem kanalını bu turda çağıracağı mesajları AYNI SIRADA
 * üretir: `sorHakeme` (varsa) → `avciHakemMesajlari` (kota kadar).
 *
 * Bu sıra `src/game/engine.ts`'in `processTurn()` gövdesinden
 * (sorHakeme → kacak ek → avci ek) TÜRETİLMİŞTİR ve orada DEĞİŞİRSE
 * burası ESKİR. Kayma riski `test/worker/hakemKopru.test.ts`'te GERÇEK
 * `processTurn()` çağrılarını kaydeden bir kanalla SABİTLENMİŞTİR —
 * sıra değişirse o test KIRILIR (sessiz kayma yok).
 */
export function turdakiHakemMesajlari(
  girdiler: TurdakiMesajGirdileri
): TurdakiHakemMesaji[] {
  const kacakEk = girdiler.kacakHakemMesajlari ?? [];
  if (kacakEk.length > 0) {
    throw new Error(
      "turdakiHakemMesajlari: `kacakHakemMesajlari` köprüde DESTEKLENMİYOR " +
        "(Worker bu kanalı API'ye bağlamıyor). Bağlanırsa köprü güncellenmeli."
    );
  }

  const mesajlar: TurdakiHakemMesaji[] = [];
  let avciKullanim = 0;

  if (girdiler.avciMove.type === "sorHakeme") {
    mesajlar.push({
      gonderen: "avci",
      mesaj: girdiler.avciMove.mesaj,
      hakemId: girdiler.avciMove.hakemId,
    });
    avciKullanim += 1;
  }

  const kota = avciHakemKotasi(girdiler.avciSpecializations);
  for (const ham of girdiler.avciHakemMesajlari ?? []) {
    // Motorun kendi davranışı: kota dolduğunda DÖNGÜ KIRILIR (kalan
    // mesajlar `rejected`e yazılır, kanala HİÇ gitmez).
    if (avciKullanim >= kota) break;
    mesajlar.push(cozEkMesaj(ham, girdiler.avciHakemId));
    avciKullanim += 1;
  }

  return mesajlar;
}

// ---------------------------------------------------------- ön geçiş

export interface OnGecisAyarlari {
  world: WorldData;
  /** Turun BAŞINDAKİ state — `processTurn` bunu MUTATE ETMEZ, kanal da
   * `getState()` ile tam bunu okur (Madde 0 doğrulaması). */
  state: MatchState;
  panel: HakemPaneli;
  dilimBaglami: DilimBaglami;
  ai: EnvAiRunlayici;
  modelAdi: string;
  zamanAsimiMs?: number;
  /** Bu maçın ÖNCEKİ turlarında yapılmış toplam hakem-mesajı sayısı. */
  gecmisCagriSayisi: number;
  /** `MAC_MODEL_CAGRI_SINIRI` — ön geçiş de AYNI bütçeye uyar. */
  cagriSiniri: number;
}

export interface OnGecisSonucu {
  /** `${hakemId}#${o hakeme bu turdaki sıra no}` → modelin HAM yanıtı. */
  yanitlar: Map<string, string>;
  /** Ağa GERÇEKTEN çıkan model çağrısı sayısı. */
  cagriSayisi: number;
  /** Çağrı sınırı yüzünden ağa çıkılMAYAN mesaj sayısı. */
  sinirAtlanan: number;
  /** Hakem id'si panelde bulunamadığı için atlanan mesaj sayısı. */
  bilinmeyenHakem: number;
}

/**
 * Turun hakem mesajlarını SIRAYLA gerçek modele sorar.
 *
 * Çağrı sınırı: `gecmisCagriSayisi + <mesajın tur içi indeksi>` sınıra
 * ulaştıysa ağa ÇIKILMAZ. Bu, `modelCagriSinirlayici.ts`'nin motor
 * tarafında uyguladığı AYNI sayma düzenidir (o da her `mesajGonder`
 * çağrısında sayacı artırır, hakem bulunsa da bulunmasa da) — bu yüzden
 * ön geçişin atladığı mesaj, motorda da sabit yanıta düşer: iki taraf
 * aynı indeksleri aynı şekilde harcar.
 *
 * Hata/zaman aşımı yedeği `workersAiModeliCagir`'ın İÇİNDE zaten var
 * (sabit yanıt döner, maç DÜŞMEZ) — burada yeniden uygulanmaz.
 */
export async function hakemYanitlariniOnHesapla(
  ayarlar: OnGecisAyarlari,
  mesajlar: readonly TurdakiHakemMesaji[]
): Promise<OnGecisSonucu> {
  const yanitlar = new Map<string, string>();
  const konusmalar = new Map<string, KonusmaSatiri[]>();
  const siralar = new Map<string, number>();
  let cagriSayisi = 0;
  let sinirAtlanan = 0;
  let bilinmeyenHakem = 0;

  function konusmaAl(hakemId: string): KonusmaSatiri[] {
    const mevcut = konusmalar.get(hakemId);
    if (mevcut !== undefined) return mevcut;
    const yeni: KonusmaSatiri[] = [];
    konusmalar.set(hakemId, yeni);
    return yeni;
  }

  for (let i = 0; i < mesajlar.length; i++) {
    if (ayarlar.gecmisCagriSayisi + i >= ayarlar.cagriSiniri) {
      sinirAtlanan += 1;
      continue;
    }

    const m = mesajlar[i];
    const hedefId = m.hakemId ?? ayarlar.panel.sistemHakemi.id;
    const hakem = hakemBul(ayarlar.panel, hedefId);
    if (hakem === undefined) {
      // Motor bu mesaja model ÇAĞIRMADAN `SABIT_RED_YANITI` döner
      // (bkz. hakemKanali.ts `mesajGonder`) — ön geçiş de çağırmaz.
      bilinmeyenHakem += 1;
      continue;
    }

    const dilim = dilimUret(ayarlar.world, ayarlar.state, hakem.dilimTuru, ayarlar.dilimBaglami);

    /**
     * İki hakem türü motorda FARKLI bağlam kurar:
     *  - sistem hakemi: BİRİKEN konuşma (`hakemKanali.ts`'teki
     *    `konusmaAl(hakem.id)`, mesaj push edildikten SONRA),
     *  - "kullanıcı" hakemleri: Worker'da platform tarafından simüle
     *    edilir ve `hakemleri.ts`'teki `otoYanit` bağlamı YALNIZ O TEK
     *    mesajla kurar (birikim YOK).
     * Köprü bu ikisini AYNEN yansıtır.
     */
    const girdi =
      hakem.tur === "sistem"
        ? (() => {
            const k = konusmaAl(hakem.id);
            k.push({ gonderen: m.gonderen, metin: m.mesaj });
            return modelGirdisiKur(dilim, k);
          })()
        : modelGirdisiKur(dilim, [{ gonderen: m.gonderen, metin: m.mesaj }]);

    const ham = await workersAiModeliCagir(
      { ai: ayarlar.ai, modelAdi: ayarlar.modelAdi, zamanAsimiMs: ayarlar.zamanAsimiMs },
      girdi
    );
    cagriSayisi += 1;

    const sira = siralar.get(hakem.id) ?? 0;
    siralar.set(hakem.id, sira + 1);
    yanitlar.set(`${hakem.id}#${sira}`, ham);

    if (hakem.tur === "sistem") {
      // HAM yanıt (motor burada SÜZÜLMÜŞ olanı yazar) — bkz. dosya
      // başındaki "BİLİNEN DAVRANIŞ FARKI" notu.
      konusmaAl(hakem.id).push({ gonderen: "hakem", metin: ham });
    }
  }

  return { yanitlar, cagriSayisi, sinirAtlanan, bilinmeyenHakem };
}

// ------------------------------------- önceden hesaplanmış model

/** Hazır yanıt bulunamayan bir çağrının kaydı. */
export interface KopruEksikOlayi {
  hakemId: string;
  sira: number;
}

export interface OnHesaplanmisModelSonucu {
  /** `createPanelKanali`'nin `sistemModeli` alanına verilir. */
  sistemModeli: HakemModeli;
  /** `createBellekKullaniciKanali`'nin `otoYanit` alanına verilir. */
  kullaniciOtoYanit: (m: KullaniciHakemMesaji) => string;
  /** `processTurn` sonrası okunur — maç kaydına yazılmak üzere. */
  eksikler: KopruEksikOlayi[];
}

/**
 * Ön geçişin topladığı yanıtları SENKRON bir `HakemModeli` olarak sunar.
 *
 * EŞLEŞTİRME `(hakemId, o hakeme bu turdaki sıra no)` ile yapılır,
 * modelin girdisinin İÇERİĞİYLE değil. Gerekçe: `HakemModeli` imzası
 * `(girdi: ModelGirdisi) => string` olduğu için modele hakem kimliği
 * HİÇ GEÇMEZ — ama sistem hakemi panelde TEKTİR (`panel.sistemHakemi`),
 * kullanıcı hakemlerinin kimliği ise `otoYanit`'in aldığı mesajda
 * ZATEN vardır. Motor kanalı deterministik sırada çağırdığı için
 * hakem başına basit bir sayaç ön geçişin sırasıyla birebir örtüşür.
 *
 * Yanıt bulunamazsa: sabit yanıt döner + olay kaydedilir, maç DÜŞMEZ
 * (goal Madde 1'in açık talimatı).
 */
export function onHesaplanmisModelOlustur(
  yanitlar: ReadonlyMap<string, string>,
  sistemHakemId: string
): OnHesaplanmisModelSonucu {
  const sayaclar = new Map<string, number>();
  const eksikler: KopruEksikOlayi[] = [];

  function al(hakemId: string): string {
    const sira = sayaclar.get(hakemId) ?? 0;
    sayaclar.set(hakemId, sira + 1);
    const hazir = yanitlar.get(`${hakemId}#${sira}`);
    if (hazir === undefined) {
      eksikler.push({ hakemId, sira });
      return KOPRU_EKSIK_YANIT;
    }
    return hazir;
  }

  return {
    sistemModeli: () => al(sistemHakemId),
    kullaniciOtoYanit: (m) => al(m.hakemId),
    eksikler,
  };
}
