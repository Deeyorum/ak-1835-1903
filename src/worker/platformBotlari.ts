import { createRng } from "../game/rng";
import type { AvciMove, HakemYanitKaydi, KacakMove, WorldPage } from "../game/types";
import type { AvciView, KacakView } from "../game/views";
import { distance, distancesTo } from "../game/world";
import { dilimeUyanSayfalar, type Dilim, type DilimTuru } from "../game/hakemDilim";
import type { EkHakemMesaji } from "../game/engine";
import { sariliMetniAyristir } from "../game/hakemKanali";
import { getWorld } from "./dunya";
import { avciHakemKotasi, dilimBaglaminiGetir, HAKEM_PANEL_BUYUKLUGU } from "./hakemleri";

/**
 * G4A — platform botları (DeeOne kararı: "rakip daima platform botu
 * (Avcı 'Kindi', basit referans Kaçak)"). Gerçek bot tek bir rolü
 * oynar; SUNUCU diğer rolü bu botlarla doldurur — bu yüzden API'de
 * "diğer tarafın hamlesini gönder" diye bir uç nokta YOKTUR,
 * /matches/{id}/move tek çağrıda turu tamamlar.
 *
 * Tohumlama: her tur, (maç tohumu, tur numarası) çiftinden türetilen
 * bir RNG kullanır — D1'de ayrı bir rng-durumu SAKLAMAYA gerek
 * duymadan tekrarlanabilir davranış sağlar.
 */
function turRng(matchSeed: number, turn: number) {
  return createRng(((matchSeed * 1000003) ^ (turn * 7919)) >>> 0);
}

const KALMA_OLASILIGI = 0.2;

/**
 * Basit referans Kaçak: çoğunlukla rastgele komşuya gider, bazen
 * yerinde kalır. G4B-1 KAPSAMINDA DEĞİŞTİRİLMEDİ (goal'ün açık
 * talimatı) — yalnız Kindi (Avcı botu) üretim mantığına taşındı.
 */
export function platformKacakHamlesi(
  matchSeed: number,
  turn: number,
  view: KacakView
): KacakMove {
  const rng = turRng(matchSeed, turn);
  if (view.komsular.length === 0 || rng.next() < KALMA_OLASILIGI) {
    return { type: "kal" };
  }
  return { type: "git", to: rng.pick(view.komsular) };
}

// ------------------------------------------------------------- Kindi

/**
 * G4B-1 — Kindi (üretim Avcı botu).
 *
 * YALNIZ Avcı'nın API üzerinden MEŞRU olarak gördüğü bilgiyi kullanır:
 *   - `view.hakemYanitlari` (G3'ün "biriktiren" tasarımı — maç boyunca
 *     birikir, Kindi kendi ayrı bir bellek TUTMAZ, her çağrıda bu
 *     görünümden okur),
 *   - `view.kendiKonum` / `view.komsular` (kendi konumu, açık dünya
 *     grafiği),
 *   - dünyanın KENDİSİ (`getWorld()` — herkese açık, G1/G2'den beri
 *     sabit).
 * GERÇEK KAÇAK KONUMUNA YA DA GİZLİ MAÇ DURUMUNA (MatchState) ERİŞİMİ
 * YOKTUR — bu fonksiyon böyle bir parametre bile ALMAZ (tip düzeyinde
 * yalıtım, G3'ün hakemModel.ts'teki aynı ilkesiyle tutarlı).
 */

/**
 * Panelin bilinen hakem id'leri. Bu bir SIR DEĞİLDİR: `hakemPanel.ts`
 * (açık kaynak motor) id'leri hep aynı sabit düzende üretir
 * (`i===0 ? "sistem" : "kullanici-"+i`) — DİLİM TÜRÜ ataması tohumludur
 * (gizli), ama HANGİ ID'LERİN VAR OLDUĞU değildir. Kindi bu yüzden
 * panel büyüklüğünden id listesini güvenle türetebilir.
 */
function panelHakemIdleri(): string[] {
  const idler: string[] = [];
  for (let i = 0; i < HAKEM_PANEL_BUYUKLUGU; i++) {
    idler.push(i === 0 ? "sistem" : `kullanici-${i}`);
  }
  return idler;
}

/**
 * Hakem yanıtlarından dilim bilgisini ayrıştırır. G4A'nın sahte
 * (`uyumluModel`) modeli SABİT bir şablon kullanır: "As far as I know,
 * the {tur} is {deger}." — bu ayrıştırma O ŞABLONA bağlıdır.
 *
 * BİLİNEN SINIR (ÖNERİ, bkz. DEFTER.md "G4B-1"): G4B-2'de gerçek bir
 * model devreye girdiğinde, ifade bu kalıba uymayabilir. Güvenli
 * başarısızlık: kalıba uymayan bir yanıt YANLIŞ AYRIŞTIRILMAZ, yalnız
 * YOK SAYILIR (Kindi o bilgiyi öğrenemez, yanlış bilgi edinmez). Daha
 * sağlam (anahtar sözcük tabanlı) bir ayrıştırma G4B-2'nin işi.
 */
const DILIM_YANIT_KALIBI = /\bthe (kategori|bolge|hareket|harf|derece) is (.+?)\.?\s*$/i;

/**
 * C ("Untrusted text contract"): `yanit` artık o turun etiketiyle
 * SARILI gelir (bkz. `hakemKanali.ts` `etiketleSar`). Ayrıştırma MUTLAKA
 * önce sarmalayıcıyı kaldırmalı — aksi halde `<<ETIKET>>` önekleri
 * `DILIM_YANIT_KALIBI`'nin "cümle SONUNDA" eşleşmesini hiç bozmasa da
 * (içerik sondan okunur) kesilmiş bir yanıttaki `[KESILDI]` işareti
 * cümle sonunu değiştirebilirdi. Bu SALT bir biçim adaptasyonudur —
 * Kindi'nin KARAR mantığı (hangi dilimi öğrendiği, ne zaman yakaladığı)
 * BİREBİR aynı kalır.
 */
function dilimYanitindanAyristir(yanit: string): Dilim | undefined {
  const { icerik } = sariliMetniAyristir(yanit);
  const esleme = DILIM_YANIT_KALIBI.exec(icerik.trim());
  if (esleme === null) return undefined;
  const deger = esleme[2].trim();
  if (deger.length === 0) return undefined;
  return { tur: esleme[1].toLowerCase() as DilimTuru, deger };
}

/**
 * Bilinen bir dilim değeri + o değerin üretildiği ANDAKİ Avcı konumu
 * (Madde 2, G4B-1b). `bolge` dilimi bu konuma GÖRE üretilir — bu
 * yüzden `bolge` değerini SONRA yeniden süzerken bu konum (SORUNUN
 * SORULDUĞU ANDAKİ konum), GÜNCEL konum DEĞİL, kullanılmalı. Diğer
 * dilim türlerinde bu alan kullanılmaz (avciPos'a bağımlı değiller).
 */
interface BilinenDilim {
  deger: string;
  avciKonum: string | undefined;
}

interface BilinenDilimlerSonucu {
  bilinen: Map<DilimTuru, BilinenDilim>;
  /** TAZE bilgi taşıyan en güncel yanıtın turu (yoksa -Infinity).
   * Döngü korumasında (bkz. kindiHamlesi) "bu tur TAZE bilgi geldi mi"
   * sorusuna yanıt verir. "Taze"nin tanımı için bkz. aşağıdaki
   * `bilinenDilimleri` notu (G4B-2a Madde 2'de DARALTILDI). */
  enSonBilgiTuru: number;
}

/**
 * Her dilim türü için EN SON bilinen değer (turn sırasına göre).
 *
 * TAZE BİLGİ TANIMI (G4B-2a Madde 2 — G4B-1b'nin bilinen sınırının
 * düzeltmesi): G4B-1b'de BAŞARIYLA AYRIŞTIRILAN HER yanıt "taze"
 * sayılıyordu — değer DEĞİŞMESE bile. Kindi her tur round-robin
 * sorduğu için bu, durağan (kal) bir Kaçak'a karşı AYNI yanlış sayfada
 * tekrar tekrar "yakala" denemesine izin veriyordu (retry'lar sıfıra
 * İNMİYOR, yalnız panel boyutuna bağlı bir sıklıkla sınırlanıyordu).
 *
 * Artık yalnız şu iki durum taze sayılır:
 *   (1) YENİ TÜRDEN bir dilim (o tür ilk kez öğreniliyor),
 *   (2) DEĞERİ DEĞİŞEN bir dilim (aynı tür, farklı değer).
 * Aynı türün aynı değerini TEKRAR bildiren bir yanıt taze DEĞİLDİR —
 * Kindi'nin aday kümesini daraltmaz, dolayısıyla başarısız bir
 * "yakala"yı tekrar denemek için gerekçe oluşturmaz.
 *
 * KALAN SINIR (ÖNERİ, ACIK_ISLER.md'ye yazıldı): `bolge` dilimi
 * SORUNUN SORULDUĞU ANDAKİ Avcı konumuna GÖRELİdir. Aynı `bolge`
 * değeri FARKLI bir `avciKonum`'dan tekrar gelirse aday kümesi
 * GERÇEKTEN değişir (aşağıda `bilinen` güncellenir), ama bu durum
 * yukarıdaki (1)/(2) tanımına girmediği için taze SAYILMAZ. Etki
 * GÜVENLİ yöndedir (Kindi daha ÇEKİNGEN olur: meşru bir retry'ı
 * kaçırabilir, yanlış bir yakala YAPMAZ) — bu yüzden goal'ün harfi
 * harfine tanımı KORUNDU, genişletme DeeOne'ın kararına bırakıldı.
 */
function bilinenDilimleri(hakemYanitlari: readonly HakemYanitKaydi[]): BilinenDilimlerSonucu {
  const bilinen = new Map<DilimTuru, BilinenDilim>();
  let enSonBilgiTuru = -Infinity;
  const siraliYanitlar = [...hakemYanitlari].sort((a, b) => a.turn - b.turn);
  for (const y of siraliYanitlar) {
    const dilim = dilimYanitindanAyristir(y.yanit);
    if (dilim === undefined) continue;

    const onceki = bilinen.get(dilim.tur);
    const tazeMi = onceki === undefined || onceki.deger !== dilim.deger;

    // `bilinen` taze OLMAYAN yanıtta da güncellenir: en son gözlem
    // kazanır (G4B-1b davranışı KORUNDU — `avciKonum` tazelenir, aday
    // kümesi anlamı DEĞİŞTİRİLMEDİ). Değişen YALNIZ tazelik sinyali.
    bilinen.set(dilim.tur, { deger: dilim.deger, avciKonum: y.avciKonum });
    if (tazeMi && y.turn > enSonBilgiTuru) enSonBilgiTuru = y.turn;
  }
  return { bilinen, enSonBilgiTuru };
}

/**
 * Kindi'nin BİR ÖNCEKİ turdaki konumu.
 *
 * Kindi istekler arası BELLEK TUTMAZ (her çağrı taze bir fonksiyon) —
 * ama her tur hakeme soru sorduğu için (Madde 3'ün round-robin'i,
 * `sorHakeme` de dahil motor tarafından kaydedilir) her turun bir
 * `HakemYanitKaydi`'sı vardır ve `avciKonum` o turdaki konumunu taşır
 * (G4B-1b Madde 2'de tam bu amaç için eklendi). Böylece "geçen tur
 * neredeydim" sorusu MEŞRU görünümden (`view.hakemYanitlari`)
 * yanıtlanabilir; gizli duruma erişim GEREKMEZ.
 *
 * `undefined`: o tura ait kayıt yok (ör. maçın ilk turu) — çağıran bunu
 * "önceki konum BİLİNMİYOR" olarak ele almak ZORUNDA.
 */
function oncekiAvciKonumu(
  hakemYanitlari: readonly HakemYanitKaydi[],
  turn: number
): string | undefined {
  for (const y of hakemYanitlari) {
    if (y.turn === turn - 1 && y.avciKonum !== undefined) return y.avciKonum;
  }
  return undefined;
}

/**
 * Madde 3 (G4B-1b) — `test/bots/filterHunter.ts` DESENİNE TAŞINDI: panel
 * hakemleri ROUND-ROBIN sırayla, TUR NUMARASINA göre deterministik bir
 * işaretçiyle seçilir. filterHunter'ın kendi closure'ında tuttuğu
 * mutable `rrPointer`'ın AYNISI DEĞİL — Kindi bir Worker isteği başına
 * TAZE bir fonksiyon çağrısıdır (istekler arası bellek YOK, bkz.
 * kindiHamlesi'nin KENDİSİ dışında hiçbir state TAŞIMAMASI ilkesi), bu
 * yüzden işaretçi `turn`'den türetilir (durum GEREKTIRMEZ, tekrarlanabilir).
 */
function roundRobinHakemler(turn: number, sayac: number): string[] {
  const idler = panelHakemIdleri();
  if (sayac <= 0 || idler.length === 0) return [];
  const sinirliSayac = Math.min(sayac, idler.length);
  const sonuc: string[] = [];
  for (let i = 0; i < sinirliSayac; i++) {
    sonuc.push(idler[(turn + i) % idler.length]);
  }
  return sonuc;
}

/**
 * "Birçok kaynak (her komşu), tek hedef" deseni — G4A'nın
 * `distancesTo()` ile ÇÖZDÜĞÜ TAM OLARAK AYNI örüntü (bkz.
 * `src/game/world.ts`, `setupMatch()`'in Avcı-başlangıcı taraması).
 *
 * BULUNAN PERFORMANS HATASI: ilk yazım her komşu için AYRI bir
 * `distance(world, k, hedef)` çağrısı yapıyordu — bu, komşu sayısı
 * kadar FARKLI kaynaktan tek-kaynaklı BFS tetikler (her biri ~0.5-2ms,
 * önbellek soğukken). `test/api/api.test.ts`'nin 20 maçlık koşusunda
 * `POST /matches/{id}/move` duvar-saati gecikmesi G4A'nın ~24-32ms'sinden
 * **171ms**'ye fırladı — doğrudan bu hatanın belirtisi (bkz. DEFTER.md
 * "G4B-1"). Düzeltme: TEK bir `distancesTo(world, hedef)` (ters BFS,
 * `hedef`'e göre önbelleklenir) — O(komşu sayısı) BFS çağrısı →
 * O(1) BFS çağrısı + O(komşu sayısı) ucuz Map okuması.
 */
function enYakinKomsuyaGit(
  world: ReturnType<typeof getWorld>,
  komsular: readonly string[],
  hedef: string
): AvciMove {
  const hedefeMesafeler = distancesTo(world, hedef);
  let enIyiKomsu: string | null = null;
  let enIyiMesafe = Infinity;
  for (const k of komsular) {
    const d = hedefeMesafeler.get(k) ?? Infinity;
    if (d < enIyiMesafe) {
      enIyiMesafe = d;
      enIyiKomsu = k;
    }
  }
  if (enIyiKomsu === null) return { type: "yakala" }; // ulaşılamaz — güvenli düşüş
  return { type: "git", to: enIyiKomsu };
}

export interface KindiKarar {
  move: AvciMove;
  /** Madde 1'in ek mesaj kanalına (round-robin soru) geçirilecek mesajlar. */
  hakemMesajlari?: EkHakemMesaji[];
}

export function kindiHamlesi(matchSeed: number, turn: number, view: AvciView): KindiKarar {
  const world = getWorld();
  const baglam = dilimBaglaminiGetir();
  const tumSayfalar: WorldPage[] = Array.from(world.pages.values());

  const { bilinen, enSonBilgiTuru } = bilinenDilimleri(view.hakemYanitlari);
  let adaylar: WorldPage[] = tumSayfalar;
  for (const [tur, { deger, avciKonum }] of bilinen) {
    adaylar = dilimeUyanSayfalar(world, adaylar, { tur, deger }, {
      ...baglam,
      // Madde 2: `bolge` SORUNUN SORULDUĞU ANDAKİ konuma göredir — o
      // konum (avciKonum) kullanılır, GÜNCEL konum (view.kendiKonum)
      // DEĞİL (Kindi o yanıttan SONRA hareket etmiş olabilir). Eski
      // (avciKonum'suz) kayıtlarda güvenli düşüş: önceki davranış.
      avciPos: tur === "bolge" ? avciKonum ?? view.kendiKonum : view.kendiKonum,
    });
  }

  /**
   * DÖNGÜ KORUMASI (DeeOne kararı, G4B-1b): `KINDI_ADAY_ESIGI` eşiği
   * KALDIRILDI — goal'ün istediği filterHunter deseninde böyle bir eşik
   * yok (DeeOne: "G4B-1'de eklenmiş sezgisel bir önlemdi, dengeye göre
   * ayarlama sayılmaz, çünkü desende zaten yok"). YERİNE: başarısız bir
   * "yakala" denemesinin olduğu sayfa, YENİ bir dilim yanıtı (başarıyla
   * ayrıştırılmış) gelene kadar aday kümesinden ÇIKARILIR.
   *
   * "Yeni yanıt" sinyali: `enSonBilgiTuru === turn - 1` mi (bu TURDA
   * TAZE bilgi geldi mi)? Değilse, kendi konum adaysa "yakala" ZATEN
   * denenmiş ve (maç hâlâ devam ettiğine göre) BAŞARISIZ olmuştur;
   * tekrar denemek yalnız döngüye (29 tur hareketsiz başarısız yakala,
   * bkz. G4B-1'in ORİJİNAL hatası) yol açar. Bu kontrol eşiksiz
   * tasarımda O HATANIN YERİNİ alır.
   *
   * G4B-2a Madde 2: "taze" artık DEĞER DEĞİŞİMİ / YENİ TÜR demektir
   * (bkz. `bilinenDilimleri` notu). Bu yüzden G4B-1b'deki "bilinen ve
   * dolayısıyla adaylar bir önceki turdakiyle AYNIDIR" gerekçesi TAM
   * OLARAK doğru değil: taze olmayan bir `bolge` yanıtı `avciKonum`'u
   * tazeleyerek aday kümesini değiştirebilir.
   *
   * **KONUM KOŞULU (G4B-2a, ÖLÇÜMLE BULUNDU — DUR bulgusunun çözümü).**
   * Madde 2'nin daraltılmış tanımı tek başına uygulandığında koruma
   * YANLIŞ POZİTİF üretti: durağan bir Kaçak'a karşı ayrıştırılan
   * yanıtların %64.6'sı değer TEKRARI olduğu için "taze bilgi yok"
   * turların %65'inde doğru çıkıyor ve koruma Kindi'yi DOĞRU sayfanın
   * üzerinde dururken bile yakalamaktan alıkoyuyordu (300 tohum: kal
   * %51.0 → %33.3, gezen %7.0 → %1.0 — bkz. DEFTER.md "G4B-2a").
   *
   * Korumanın GERÇEK sorusu "bu sayfada ZATEN deneyip başarısız oldum
   * mu?"dur. Kindi bu tur BAŞKA bir sayfaya taşındıysa orada hiç deneme
   * YAPILMAMIŞTIR — o yüzden koruma yalnız KONUM DEĞİŞMEDİĞİNDE
   * tetiklenir. Önceki konum gizli durumdan değil, meşru görünümdeki
   * `avciKonum` kaydından okunur (bkz. `oncekiAvciKonumu`).
   */
  const buTurTazeBilgi = enSonBilgiTuru === turn - 1;
  const oncekiKonum = oncekiAvciKonumu(view.hakemYanitlari, turn);
  // No-implicit-undefined: önceki konum BİLİNMİYORSA (maçın ilk turu)
  // "değişmedi" VARSAYILMAZ — koruma tetiklenmez (orada henüz bir
  // yakala denemesi olamazdı).
  const konumDegismedi = oncekiKonum !== undefined && oncekiKonum === view.kendiKonum;
  if (!buTurTazeBilgi && konumDegismedi && adaylar.some((p) => p.title === view.kendiKonum)) {
    adaylar = adaylar.filter((p) => p.title !== view.kendiKonum);
  }

  let move: AvciMove;
  let moveSorHakemeKullandi = false;

  // 1) Bilgimiz varsa VE kendi konumumuz (döngü koruması SONRASI) hâlâ
  // adaylardan biriyse yakala — EŞİK YOK (filterHunter deseni: ne kadar
  // kalabalık olursa olsun, kendi konum adaysa dene).
  if (bilinen.size > 0 && adaylar.some((p) => p.title === view.kendiKonum)) {
    move = { type: "yakala" };
  } else if (view.komsular.length === 0) {
    // 2) Hiç komşu yoksa hakeme sormak tek seçenek (hareket edilemiyor,
    // eski davranış korunur).
    move = { type: "sorHakeme", mesaj: "What do you know?" };
    moveSorHakemeKullandi = true;
  } else if (bilinen.size > 0 && adaylar.length > 0) {
    // 3) Bilgimiz var (adaylar boş değil) — en yakın adaya doğru git,
    // aday kümesi ne kadar büyük olursa olsun (EŞİK YOK — her zaman en
    // iyi tahmine göre hareket, filterHunter deseni).
    let hedef: string | null = null;
    let enIyiMesafe = Infinity;
    for (const a of adaylar) {
      const d = distance(world, view.kendiKonum, a.title) ?? Infinity;
      if (d < enIyiMesafe) {
        enIyiMesafe = d;
        hedef = a.title;
      }
    }
    move =
      hedef === null
        ? { type: "git", to: turRng(matchSeed, turn).pick(view.komsular) }
        : enYakinKomsuyaGit(world, view.komsular, hedef);
  } else {
    // 4) Hiç bilgimiz yok (veya döngü koruması TEK adayı elediği için
    // aday kümesi boşaldı) — rastgele komşuya git. Bilgi toplama bu
    // harekete BAĞIMLI DEĞİL (aşağıdaki round-robin, hareketten
    // BAĞIMSIZ her tur sorar).
    move = { type: "git", to: turRng(matchSeed, turn).pick(view.komsular) };
  }

  /**
   * Madde 3 — SÜREKLİ round-robin soru (eski "TEK SEFER sor, sonra asla
   * yenileme" davranışının YERİNE): her tur, hareketten BAĞIMSIZ olarak
   * panelin bir kısmını (kotanın hareketin ZATEN kullanmadığı kısmı
   * kadar) ek mesaj kanalıyla sorar. `view.kendiUzmanliklari`'nden
   * KENDİ kotasını (taban 1 + Arabulucu +1) hesaplar — motorun
   * `hakemKotasi()`'yle AYNI formül (bkz. hakemleri.ts `avciHakemKotasi`
   * notu), Kindi bunu YALNIZ AvciView'den türetir (dışa aktarılan bir
   * engine fonksiyonuna gerek yok, uzmanlıklar zaten görünümde).
   */
  const kota = avciHakemKotasi(view.kendiUzmanliklari);
  const kalanKota = moveSorHakemeKullandi ? kota - 1 : kota;
  const sorulacaklar = roundRobinHakemler(turn, kalanKota);
  const hakemMesajlari: EkHakemMesaji[] | undefined =
    sorulacaklar.length > 0
      ? sorulacaklar.map((hakemId) => ({ mesaj: "What do you know?", hakemId }))
      : undefined;

  return { move, hakemMesajlari };
}
