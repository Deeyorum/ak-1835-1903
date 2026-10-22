import { getWorld } from "../../src/worker/dunya";
import { dilimBaglaminiGetir } from "../../src/worker/hakemleri";
import { kindiHamlesi, platformKacakHamlesi } from "../../src/worker/platformBotlari";
import { bolgeDilimi, dilimeUyanSayfalar, dilimUret, TUM_DILIM_TURLERI } from "../../src/game/hakemDilim";
import type { EkHakemMesaji } from "../../src/game/engine";
import type { AvciView } from "../../src/game/views";
import type { HakemYanitKaydi, MatchState } from "../../src/game/types";

/** Kindi her zaman nesne biçimi üretir (bkz. platformBotlari.ts), ama
 * `EkHakemMesaji` tipi düz string'i de kabul eder — test burada güvenle
 * ayırt eder. */
function ekMesajHakemId(m: EkHakemMesaji): string | undefined {
  return typeof m === "string" ? undefined : m.hakemId;
}

/**
 * G4B-1 — Kindi birim sınaması. GERÇEK dünya verisi + GERÇEK dilim
 * üretimi kullanılır (sahte değil) — yalnız hakem YANITLARI el ile
 * kuruluyor (uyumluModel'in ürettiği GERÇEK şablonla, bkz.
 * platformBotlari.ts'teki DILIM_YANIT_KALIBI notu).
 */

let failures = 0;
function kontrol(ad: string, kosul: boolean, detay = ""): void {
  console.log(`${kosul ? "✓" : "✗"} ${ad}${detay === "" ? "" : ` — ${detay}`}`);
  if (!kosul) failures++;
}

function sahteState(kacakPos: string, avciPos: string, turn = 4): MatchState {
  return {
    seed: 1,
    turn,
    turnLimit: 30,
    kacakPosition: kacakPos,
    avciPosition: avciPos,
    kacakSpecializations: [],
    avciSpecializations: [],
    kacakStayStreak: 0,
    kacakMoveCount: 1,
    kacakStayCount: 0,
    status: "devam",
    log: [],
  };
}

function sahteView(state: MatchState, world: ReturnType<typeof getWorld>, hakemYanitlari: HakemYanitKaydi[]): AvciView {
  return {
    kendiKonum: state.avciPosition,
    komsular: world.adjacency.get(state.avciPosition) ?? [],
    kendiUzmanliklari: [],
    rakipUzmanliklari: [],
    tur: state.turn,
    turSiniri: state.turnLimit,
    durum: state.status,
    hakemYanitlari,
  };
}

function uyumluYanit(tur: string, deger: string): string {
  return `As far as I know, the ${tur} is ${deger}.`;
}

function main() {
  const world = getWorld();
  const baglam = dilimBaglaminiGetir();
  const titles = world.titles;

  console.log(`=== G4B-1: Kindi birim sınaması (${titles.length} sayfa) ===\n`);

  // Referans Kaçak değişmedi mi? (goal: "Referans Kaçak botu değişmeyecek")
  const kacakHamle = platformKacakHamlesi(1, 1, {
    kendiKonum: titles[0],
    komsular: world.adjacency.get(titles[0]) ?? [],
    kendiUzmanliklari: [],
    rakipUzmanliklari: [],
    tur: 1,
    turSiniri: 30,
    durum: "devam",
  });
  kontrol(
    "referans Kaçak hâlâ git/kal döner (değişmedi)",
    kacakHamle.type === "git" || kacakHamle.type === "kal"
  );

  // --- 1) Hiç hakem yanıtı yok → hareket (git/sorHakeme) + round-robin
  // ek mesaj kanalıyla bir hakeme sorar (Madde 3: SÜREKLİ soru, harekete
  // bağımlı değil). turn=4, kota=1 (Arabulucu yok) → roundRobinHakemler
  // idler[4%3]=idler[1]="kullanici-1" döner (deterministik).
  const kacakPos1 = titles[100];
  const avciPos1 = titles[900];
  const state1 = sahteState(kacakPos1, avciPos1);
  const view1 = sahteView(state1, world, []);
  const hamle1 = kindiHamlesi(1, state1.turn, view1);
  kontrol(
    "hiç bilgi yokken hareket eder (git veya komşusuzsa sorHakeme)",
    hamle1.move.type === "git" || hamle1.move.type === "sorHakeme",
    JSON.stringify(hamle1)
  );
  kontrol(
    "hiç bilgi yokken ek mesaj kanalıyla round-robin bir hakeme sorar (move sorHakeme KULLANMADIYSA)",
    hamle1.move.type === "sorHakeme" ||
      (hamle1.hakemMesajlari !== undefined &&
        hamle1.hakemMesajlari.length === 1 &&
        ekMesajHakemId(hamle1.hakemMesajlari[0]) === "kullanici-1"),
    JSON.stringify(hamle1)
  );

  // --- 2) sistem + kullanici-1 soruldu, kullanici-2 soruLMADI. DeeOne
  // kararıyla (G4B-1b) KINDI_ADAY_ESIGI KALDIRILDI — artık aday kümesi
  // BÜYÜKLÜĞÜ önemli değil, yalnız "kendi konum aday mı" sorusu. Bilgi
  // TAZE (turn=3, en son yanıt turn=2 → turn-1) olduğu için döngü
  // koruması devreye GİRMEZ.
  const harfDegeri = "Z";
  const bolgeDegeri = "orta";
  let adaylar2 = Array.from(world.pages.values());
  adaylar2 = dilimeUyanSayfalar(world, adaylar2, { tur: "harf", deger: harfDegeri }, { ...baglam, avciPos: avciPos1 });
  adaylar2 = dilimeUyanSayfalar(world, adaylar2, { tur: "bolge", deger: bolgeDegeri }, { ...baglam, avciPos: avciPos1 });

  const yanitlar2: HakemYanitKaydi[] = [
    { turn: 1, hakemId: "sistem", soru: "x", yanit: uyumluYanit("harf", harfDegeri) },
    { turn: 2, hakemId: "kullanici-1", soru: "x", yanit: uyumluYanit("bolge", bolgeDegeri) },
  ];
  const view2 = sahteView(sahteState(kacakPos1, avciPos1, 3), world, yanitlar2);
  const hamle2 = kindiHamlesi(1, 3, view2);
  const kendiKonumAday2 = adaylar2.some((p) => p.title === avciPos1);
  kontrol(
    `2 dilim biliniyor (eşik YOK) → kendiKonumAday=${kendiKonumAday2} ⇒ ${kendiKonumAday2 ? "yakala" : "git"}`,
    kendiKonumAday2 ? hamle2.move.type === "yakala" : hamle2.move.type === "git",
    JSON.stringify(hamle2)
  );
  // Madde 3: round-robin SÜREKLİ sorar — "kullanici-2" HENÜZ sorulmamış
  // olsa bile, bu turun sırası (turn=3, kota=1) "sistem"e denk gelir
  // (eski "sorulmamışı sor" davranışı YERİNE sabit döngü).
  kontrol(
    "round-robin ek mesaj kanalı turn=3'te 'sistem'e sorar (deterministik döngü)",
    hamle2.move.type === "sorHakeme" ||
      (hamle2.hakemMesajlari !== undefined && ekMesajHakemId(hamle2.hakemMesajlari[0]) === "sistem"),
    JSON.stringify(hamle2.hakemMesajlari)
  );

  // --- 2b) REGRESYON (DeeOne kararı, G4B-1b): `KINDI_ADAY_ESIGI`
  // KALDIRILDI (goal'ün istediği filterHunter deseninde eşik yok —
  // G4B-1'de eklenmiş sezgisel bir önlemdi). YERİNE: "aynı sayfada,
  // YENİ bilgi gelmeden İKİNCİ yakala yok" — başarısız bir yakalamanın
  // olduğu sayfa, yeni bir dilim yanıtı gelene kadar aday kümesinden
  // çıkar (bkz. platformBotlari.ts `buTurTazeBilgi` notu). Senaryo:
  // Kindi TESADÜFEN Kaçak'ın ÜZERİNDE (kacakPos=avciPos) — TEK bir
  // gerçek dilim bilgisi bile kendi konumunu "aday" yapar (eşik artık
  // yok, bu HER ZAMAN doğru). 1. çağrı (TAZE bilgi, turn-1'de gelen) →
  // yakala BEKLENİR. 2. çağrı (AYNI, BAYAT bilgi — yeni yanıt YOK) →
  // yakala ARTIK BEKLENMEZ (29 tur hareketsiz tekrar — G4B-1'in ORİJİNAL
  // hatası — burada TEKRARLANMAMALI).
  // G4B-2a: koruma artık KONUM DEĞİŞMEDİĞİNDE tetiklenir (bkz.
  // platformBotlari.ts "KONUM KOŞULU") — bu yüzden fikstürler
  // `avciKonum` TAŞIMAK ZORUNDA. Gerçekçi de budur: Kindi HER tur soru
  // sorar, yani her turun bir kaydı vardır; turn=2'deki yanıt
  // AYRIŞTIRILAMAYAN bir yanıttır (yeni dilim bilgisi YOK ama o turdaki
  // konumu kaydeder — gerçek bir modelin şablona uymayan yanıtı).
  const kacakPos2b = titles[600];
  const tur2b = dilimUret(world, sahteState(kacakPos2b, kacakPos2b, 1), "harf", baglam);
  const yanitlar2bIlk: HakemYanitKaydi[] = [
    {
      turn: 1,
      hakemId: "sistem",
      soru: "x",
      yanit: uyumluYanit(tur2b.tur, tur2b.deger),
      avciKonum: kacakPos2b,
    },
  ];
  const view2bIlk = sahteView(sahteState(kacakPos2b, kacakPos2b, 2), world, yanitlar2bIlk);
  const hamle2bIlk = kindiHamlesi(1, 2, view2bIlk);
  kontrol(
    "1. çağrı: TAZE bilgiyle (kendi konum=Kaçak'ın konumu) yakala dener",
    hamle2bIlk.move.type === "yakala",
    JSON.stringify(hamle2bIlk)
  );
  // 2. çağrı: YENİ DİLİM BİLGİSİ YOK (turn=2'nin yanıtı ayrıştırılamadı)
  // ve Kindi AYNI sayfada kaldı — maç hâlâ devam ettiğine göre 1.
  // yakala BAŞARISIZ oldu, tekrar denemek döngüdür.
  const yanitlar2b: HakemYanitKaydi[] = [
    ...yanitlar2bIlk,
    {
      turn: 2,
      hakemId: "kullanici-1",
      soru: "x",
      yanit: "I am afraid I cannot help with that.",
      avciKonum: kacakPos2b,
    },
  ];
  const view2bIkinci = sahteView(sahteState(kacakPos2b, kacakPos2b, 3), world, yanitlar2b);
  const hamle2bIkinci = kindiHamlesi(1, 3, view2bIkinci);
  kontrol(
    'REGRESYON: 2. çağrı (BAYAT bilgi, yeni yanıt YOK) AYNI sayfada İKİNCİ "yakala" ÜRETMİYOR',
    hamle2bIkinci.move.type !== "yakala",
    JSON.stringify(hamle2bIkinci)
  );

  // --- 2c) G4B-2a Madde 2 REGRESYONU: "AYNI DEĞER TEKRAR GELİNCE
  // İKİNCİ YAKALA YOK". G4B-1b'nin bilinen sınırı buydu: döngü koruması
  // BAŞARIYLA AYRIŞTIRILAN HER yanıtı "taze" sayıyordu, bu yüzden Kindi
  // her tur round-robin sorduğu için durağan bir Kaçak'a karşı AYNI
  // yanlış sayfada tekrar "yakala" deneyebiliyordu. Artık yalnız
  // DEĞERİ DEĞİŞEN ya da YENİ TÜRDEN yanıt taze sayılır.
  //
  // Senaryo 2b ile AYNI (Kindi tesadüfen Kaçak'ın üzerinde), tek fark:
  // turn=2'de AYNI türün AYNI değeri TEKRAR bildiriliyor. ESKİ kuralda
  // bu "taze" sayılır ve turn=3'te İKİNCİ bir yakala üretilirdi.
  const kacakPos2c = titles[600];
  const tur2c = dilimUret(world, sahteState(kacakPos2c, kacakPos2c, 1), "harf", baglam);
  const yanitlar2c: HakemYanitKaydi[] = [
    {
      turn: 1,
      hakemId: "sistem",
      soru: "x",
      yanit: uyumluYanit(tur2c.tur, tur2c.deger),
      avciKonum: kacakPos2c,
    },
    // turn=2: AYNI tür, AYNI değer — başka bir hakem de olabilirdi; bilgi
    // içeriği DEĞİŞMİYOR. Konum da DEĞİŞMEDİ (Kindi burada kaldı).
    {
      turn: 2,
      hakemId: "kullanici-1",
      soru: "x",
      yanit: uyumluYanit(tur2c.tur, tur2c.deger),
      avciKonum: kacakPos2c,
    },
  ];
  const view2cIlk = sahteView(sahteState(kacakPos2c, kacakPos2c, 2), world, [yanitlar2c[0]]);
  kontrol(
    "2c kurulumu geçerli: İLK (gerçekten taze) bilgiyle yakala ÜRETİLİYOR",
    kindiHamlesi(1, 2, view2cIlk).move.type === "yakala"
  );
  const view2cIkinci = sahteView(sahteState(kacakPos2c, kacakPos2c, 3), world, yanitlar2c);
  const hamle2cIkinci = kindiHamlesi(1, 3, view2cIkinci);
  kontrol(
    'REGRESYON (G4B-2a Madde 2): AYNI DEĞER turn-1\'de TEKRAR geldi ⇒ "taze" SAYILMIYOR, İKİNCİ yakala YOK',
    hamle2cIkinci.move.type !== "yakala",
    JSON.stringify(hamle2cIkinci)
  );

  // --- 2d) POZİTİF KONTROL: tazelik tümden kapanmadı. AYNI tür ama
  // DEĞİŞEN değer taze SAYILMALI (yoksa 2c'nin kontrolü "her şeyi
  // engelle" ile de geçerdi — bu durumda Kindi hiç yakalayamazdı).
  const yanlisHarf = tur2c.deger === "A" ? "B" : "A";
  const yanitlar2d: HakemYanitKaydi[] = [
    {
      turn: 1,
      hakemId: "sistem",
      soru: "x",
      yanit: uyumluYanit("harf", yanlisHarf),
      avciKonum: kacakPos2c,
    },
    // turn=2: AYNI tür, DEĞİŞEN (ve bu kez doğru) değer ⇒ TAZE.
    {
      turn: 2,
      hakemId: "kullanici-1",
      soru: "x",
      yanit: uyumluYanit(tur2c.tur, tur2c.deger),
      avciKonum: kacakPos2c,
    },
  ];
  const view2d = sahteView(sahteState(kacakPos2c, kacakPos2c, 3), world, yanitlar2d);
  const hamle2d = kindiHamlesi(1, 3, view2d);
  kontrol(
    "POZİTİF KONTROL: AYNI türün DEĞİŞEN değeri TAZE sayılır ⇒ yakala ÜRETİLİR",
    hamle2d.move.type === "yakala",
    `yanlışHarf=${yanlisHarf} doğruHarf=${tur2c.deger} ${JSON.stringify(hamle2d)}`
  );

  // --- 2e) G4B-2a KONUM KOŞULU (DUR bulgusunun çözümü, ÖLÇÜMLE
  // doğrulandı): taze bilgi OLMASA bile Kindi bu tur BAŞKA bir sayfaya
  // TAŞINDIYSA koruma tetiklenMEMELİ — yeni sayfada daha önce bir
  // "yakala" denemesi OLAMAZ. Bu koşul olmadan Kindi doğru sayfanın
  // üzerinde dururken bile yakalamayı reddediyordu (kal %51.0 → %33.3).
  const baskaKonum2e = titles[601];
  const yanitlar2e: HakemYanitKaydi[] = [
    {
      turn: 1,
      hakemId: "sistem",
      soru: "x",
      yanit: uyumluYanit(tur2c.tur, tur2c.deger),
      // Kindi turn=1'de BAŞKA bir sayfadaydı...
      avciKonum: baskaKonum2e,
    },
    {
      turn: 2,
      hakemId: "kullanici-1",
      soru: "x",
      // ...turn=2'de yeni dilim bilgisi GELMEDİ (ayrıştırılamayan yanıt)
      // ve hâlâ o BAŞKA sayfadaydı.
      yanit: "I am afraid I cannot help with that.",
      avciKonum: baskaKonum2e,
    },
  ];
  // turn=3: Kindi Kaçak'ın sayfasına TAŞINDI (kendiKonum DEĞİŞTİ).
  const view2e = sahteView(sahteState(kacakPos2c, kacakPos2c, 3), world, yanitlar2e);
  const hamle2e = kindiHamlesi(1, 3, view2e);
  kontrol(
    "KONUM KOŞULU: taze bilgi YOK ama Kindi TAŞINDI ⇒ koruma tetiklenmez, yakala ÜRETİLİR",
    hamle2e.move.type === "yakala",
    `önceki=${baskaKonum2e} şimdi=${kacakPos2c} ${JSON.stringify(hamle2e)}`
  );

  // --- 3) Tüm 3 hakem GERÇEK dilim değerleriyle Kaçak'ın konumunu
  // ifşa ediyor → aday küme tek bir sayfaya (Kaçak'ın GERÇEK konumuna)
  // daralmalı. Kindi BUNU BİLMİYOR (yalnız yanıtları görüyor) ama
  // aday kümesi doğru daralırsa kendi konumu aday olduğunda yakalar.
  const kacakPos3 = titles[300];
  // turn=4 (3'ün entry'si İÇİN "TAZE", bkz. buTurTazeBilgi notu —
  // döngü koruması bu çağrıyı YENİ bir bilgi anı sayar, ENGELLEMEZ).
  const gercekState = sahteState(kacakPos3, kacakPos3, 4); // Kindi TESADÜFEN kaçağın üzerinde
  const tumDilimler = TUM_DILIM_TURLERI.map((tur) => dilimUret(world, gercekState, tur, baglam));
  const yanitlar3: HakemYanitKaydi[] = [
    { turn: 1, hakemId: "sistem", soru: "x", yanit: uyumluYanit(tumDilimler[0].tur, tumDilimler[0].deger) },
    { turn: 2, hakemId: "kullanici-1", soru: "x", yanit: uyumluYanit(tumDilimler[1].tur, tumDilimler[1].deger) },
    { turn: 3, hakemId: "kullanici-2", soru: "x", yanit: uyumluYanit(tumDilimler[2].tur, tumDilimler[2].deger) },
  ];
  const view3 = sahteView(gercekState, world, yanitlar3);
  const hamle3 = kindiHamlesi(1, 4, view3);
  kontrol(
    "kendi konumu (gerçek dilimlerle tutarlı) aday kümesindeyse yakalar",
    hamle3.move.type === "yakala",
    JSON.stringify(hamle3)
  );

  // --- 4) Ayrıştırılamayan yanıtlar (örn. süzgeç reddi/suskun hakem)
  // → bilgi edinilemez, rastgele komşuya güvenli düşüş (çökme YOK). ---
  const yanitlar4: HakemYanitKaydi[] = [
    { turn: 1, hakemId: "sistem", soru: "x", yanit: "Bu konuda bilgi veremem." },
    { turn: 2, hakemId: "kullanici-1", soru: "x", yanit: "Bu konuda bilgi veremem." },
    { turn: 3, hakemId: "kullanici-2", soru: "x", yanit: "Bu konuda bilgi veremem." },
  ];
  const kacakPos4 = titles[500];
  const avciPos4 = titles[1000];
  const state4 = sahteState(kacakPos4, avciPos4, 6);
  const view4 = sahteView(state4, world, yanitlar4);
  let hamle4Hata: unknown;
  let hamle4: ReturnType<typeof kindiHamlesi> | undefined;
  try {
    hamle4 = kindiHamlesi(1, 6, view4);
  } catch (e) {
    hamle4Hata = e;
  }
  kontrol("ayrıştırılamayan yanıtlarla çökme YOK", hamle4Hata === undefined, String(hamle4Hata));
  kontrol(
    "bilgi edinilemediyse komşuya gider (rastgele düşüş) veya tekrar sorar",
    hamle4 !== undefined && (hamle4.move.type === "git" || hamle4.move.type === "sorHakeme"),
    JSON.stringify(hamle4)
  );
  if (hamle4 !== undefined && hamle4.move.type === "git") {
    kontrol(
      "gidilen sayfa gerçek bir komşu",
      (world.adjacency.get(avciPos4) ?? []).includes(hamle4.move.to)
    );
  }

  // --- 5) Komşusu olmayan bir sayfada (nadir ama olası) çökme yok ---
  let yapraksizSayfa: string | undefined;
  for (const t of titles) {
    if ((world.adjacency.get(t) ?? []).length === 0) {
      yapraksizSayfa = t;
      break;
    }
  }
  if (yapraksizSayfa !== undefined) {
    const state5 = sahteState(titles[0], yapraksizSayfa, 2);
    const view5 = sahteView(state5, world, []);
    let hata5: unknown;
    try {
      kindiHamlesi(1, 2, view5);
    } catch (e) {
      hata5 = e;
    }
    kontrol("komşusuz sayfada çökme yok", hata5 === undefined, String(hata5));
  } else {
    console.log("  (bilgi) dünyada komşusuz (çıkan-derecesi 0) sayfa yok — bu dal atlandı");
  }

  // --- 6) Madde 3: Arabulucu beyanlıysa kota 2'dir — hareket sorHakeme
  // KULLANMADIYSA round-robin AYNI turda 2 FARKLI hakeme sorar.
  const kacakPos6 = titles[200];
  const avciPos6 = titles[950];
  const state6 = sahteState(kacakPos6, avciPos6, 7);
  const view6: AvciView = { ...sahteView(state6, world, []), kendiUzmanliklari: ["arabulucu"] };
  const hamle6 = kindiHamlesi(1, 7, view6);
  kontrol(
    "Arabulucu beyanlıyken, hareket sorHakeme kullanmadıysa round-robin 2 hakeme sorar",
    hamle6.move.type === "sorHakeme" ||
      (hamle6.hakemMesajlari !== undefined && hamle6.hakemMesajlari.length === 2),
    JSON.stringify(hamle6)
  );

  // --- 7) Madde 2 REGRESYONU: `bolge` dilimi, SORUNUN SORULDUĞU
  // ANDAKİ Avcı konumuna (avciKonum) göre süzülmeli — GÜNCEL konuma
  // (view.kendiKonum) göre DEĞİL. Aşağıda, bu iki taban FARKLI sonuç
  // veren bir (avciKonumEski, avciKonumYeni, kacak) üçlüsü aranır;
  // bulunursa Kindi'nin DOĞRU (avciKonum) tabanını kullandığı,
  // kendisinin hâlâ "yakala" KARARINI avciKonumYeni'ne göre DEĞİL
  // avciKonumEski'ye göre doğru adaylarla verdiği doğrulanır.
  let bolgeRegresyonKanit:
    | { avciKonumEski: string; avciKonumYeni: string; kacakPos: string; bolge: string }
    | undefined;
  outer: for (let i = 0; i < titles.length && bolgeRegresyonKanit === undefined; i += 37) {
    for (let j = 0; j < titles.length; j += 53) {
      const a = titles[i];
      const b = titles[j];
      if (a === b) continue;
      for (let k = 0; k < titles.length; k += 97) {
        const kacak = titles[k];
        const bEski = bolgeDilimi(world, a, kacak);
        const bYeni = bolgeDilimi(world, b, kacak);
        if (bEski !== null && bYeni !== null && bEski !== bYeni) {
          bolgeRegresyonKanit = { avciKonumEski: a, avciKonumYeni: b, kacakPos: kacak, bolge: bEski };
          break outer;
        }
      }
    }
  }
  if (bolgeRegresyonKanit !== undefined) {
    const { avciKonumEski, avciKonumYeni, kacakPos: kacakPos7, bolge } = bolgeRegresyonKanit;
    // DOĞRU taban (avciKonumEski) ile hesaplanan aday kümesi gerçek
    // Kaçak konumunu içeriyor mu? (Kindi'nin BİLMEDİĞİ, test oracle'ı.)
    const dogruAdaylar = dilimeUyanSayfalar(
      world,
      Array.from(world.pages.values()),
      { tur: "bolge", deger: bolge },
      { ...baglam, avciPos: avciKonumEski }
    );
    const dogruIcerir = dogruAdaylar.some((p) => p.title === kacakPos7);

    // YANLIŞ taban (avciKonumYeni, "güncel konum" hatası) aynı soruya
    // FARKLI bir cevap veriyor olmalı — test kurulumunun GEÇERLİ olduğunun
    // kanıtı.
    const yanlisAdaylar = dilimeUyanSayfalar(
      world,
      Array.from(world.pages.values()),
      { tur: "bolge", deger: bolge },
      { ...baglam, avciPos: avciKonumYeni }
    );
    const yanlisIcerir = yanlisAdaylar.some((p) => p.title === kacakPos7);
    kontrol(
      "test kurulumu geçerli: eski/güncel konum tabanı FARKLI aday kümesi veriyor",
      dogruIcerir !== yanlisIcerir,
      `dogru=${dogruIcerir} yanlis=${yanlisIcerir}`
    );

    // Kindi'yi kur: tek bilinen dilim `bolge`, avciKonum=AVCIKONUMESKİ
    // (sorunun sorulduğu an), Kindi ŞİMDİ avciKonumYeni'ye hareket etmiş
    // (view.kendiKonum). Kindi gerçek Kaçak konumunu BİLMEZ — yalnız
    // "kendi konumu (avciKonumYeni) aday kümesinde mi" sorusuna DOĞRU
    // tabanla (avciKonumEski) yanıt vermeli.
    const kendiKonumAdayMi = dogruAdaylar.some((p) => p.title === avciKonumYeni);
    const yanitlar7: HakemYanitKaydi[] = [
      {
        turn: 1,
        hakemId: "sistem",
        soru: "x",
        yanit: uyumluYanit("bolge", bolge),
        avciKonum: avciKonumEski,
      },
    ];
    const state7 = sahteState(kacakPos7, avciKonumYeni, 2);
    const view7 = sahteView(state7, world, yanitlar7);
    const hamle7 = kindiHamlesi(1, 2, view7);
    // Eşik YOK (DeeOne kararı, G4B-1b) — "yakala" doğrudan kendiKonumAdayMi
    // ile belirlenir (bilgi TAZE: tek yanıt turn=1, çağrı turn=2 → turn-1).
    kontrol(
      "bolge süzmesi avciKonum (sorunun sorulduğu an) tabanlıdır, GÜNCEL konum DEĞİL",
      (hamle7.move.type === "yakala") === kendiKonumAdayMi,
      `kendiKonumAdayMi=${kendiKonumAdayMi} hamle=${JSON.stringify(hamle7)}`
    );
  } else {
    console.log("  (bilgi) farklı bolge bantları veren bir (eski,yeni,kaçak) üçlüsü bulunamadı — Madde 2 regresyon dalı atlandı");
  }

  console.log(`\n=== SONUÇ ===`);
  console.log(failures === 0 ? "✓ Tüm Kindi testleri geçti." : `✗ ${failures} test BAŞARISIZ.`);
  if (failures > 0) process.exit(1);
}

main();
