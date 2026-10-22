import { getWorld } from "../../src/worker/dunya";
import {
  dilimBaglaminiGetir,
  macIcinHakemKanaliOlustur,
  macPaneliniKur,
} from "../../src/worker/hakemleri";
import {
  hakemModunuCoz,
  hakemYanitlariniOnHesapla,
  onHesaplanmisModelOlustur,
  turdakiHakemMesajlari,
  KOPRU_EKSIK_YANIT,
  VARSAYILAN_HAKEM_MODU,
} from "../../src/worker/hakemKopru";
import { MODEL_HATASI_SABIT_YANITI } from "../../src/worker/workersAiHakemi";
import { setupMatch, DEFAULT_TURN_LIMIT } from "../../src/game/setup";
import { processTurn, type EkHakemMesaji } from "../../src/game/engine";
import { createOlayToplayici } from "../../src/game/hakemSuzgec";
import type { AvciMove, MatchState, Role, Specialization } from "../../src/game/types";
import type { HakemKanali } from "../../src/game/hakemKanali";
import { sariliMetniAyristir } from "../../src/game/hakemKanali";

/** C ("Untrusted text contract"): motora ulaşan HER yanıt artık o
 * turun etiketiyle SARILI — bu testler model çıktısını tanırken önce
 * sarmalayıcıyı açıkça kaldırır. */
function icerikAyikla(sarili: string): string {
  return sariliMetniAyristir(sarili).icerik;
}

/**
 * G4B-2a Madde 1 — model köprüsü (b yolu) birim sınaması.
 *
 * Ağ YOK: `env.AI` yerine `EnvAiRunlayici`'yi uygulayan sahte bir
 * nesne verilir (G4B-1'in `workersAiHakemi.test.ts`'indeki aynı desen).
 * Gerçek model sınaması duman testinin işi (Madde 4).
 */

let failures = 0;
function kontrol(ad: string, kosul: boolean, detay = ""): void {
  console.log(`${kosul ? "✓" : "✗"} ${ad}${detay === "" ? "" : ` — ${detay}`}`);
  if (!kosul) failures++;
}

/** Çağrıları kaydeden sahte AI. `uretici` sıra numarasına göre yanıt verir. */
function sahteAi(uretici: (sira: number, mesajlar: unknown) => unknown) {
  const cagrilar: { model: string; mesajlar: { role: string; content: string }[] }[] = [];
  return {
    cagrilar,
    ai: {
      run(model: string, inputs: Record<string, unknown>): Promise<unknown> {
        const mesajlar = inputs.messages as { role: string; content: string }[];
        cagrilar.push({ model, mesajlar });
        return Promise.resolve(uretici(cagrilar.length - 1, mesajlar));
      },
    },
  };
}

function yeniMac(seed: number, avciSpecializations: Specialization[] = []): MatchState {
  return setupMatch(getWorld(), {
    seed,
    kacakSpecializations: [],
    avciSpecializations,
    turnLimit: DEFAULT_TURN_LIMIT,
  });
}

/** `processTurn`'ün hakem kanalını GERÇEKTEN hangi sırayla çağırdığını kaydeder. */
function kaydedenKanal(): { kanal: HakemKanali; kayit: { gonderen: Role; mesaj: string; hakemId: string | undefined }[] } {
  const kayit: { gonderen: Role; mesaj: string; hakemId: string | undefined }[] = [];
  return {
    kayit,
    kanal: {
      mesajGonder(gonderen, mesaj, hakemId) {
        kayit.push({ gonderen, mesaj, hakemId });
        return "kayıt";
      },
    },
  };
}

async function main() {
  const world = getWorld();
  const dilimBaglami = dilimBaglaminiGetir();

  console.log(`=== G4B-2a Madde 1: model köprüsü (b yolu) ===\n`);

  // --- 1) HAKEM_MODU çözümü -------------------------------------------
  kontrol("HAKEM_MODU verilmezse varsayılan 'sahte'", hakemModunuCoz(undefined) === "sahte");
  kontrol("boş dizge de varsayılana düşer", hakemModunuCoz("") === VARSAYILAN_HAKEM_MODU);
  kontrol("'sahte' tanınır", hakemModunuCoz("sahte") === "sahte");
  kontrol("'workersAi' tanınır", hakemModunuCoz("workersAi") === "workersAi");
  let modHatasi = "";
  try {
    hakemModunuCoz("SAHTE");
  } catch (e) {
    modHatasi = e instanceof Error ? e.message : String(e);
  }
  kontrol(
    "tanınmayan değer SESSİZCE sahteye DÜŞMEZ, hata verir",
    modHatasi.includes("tanınmayan HAKEM_MODU"),
    modHatasi
  );

  // --- 2) Mesaj sırası motorun GERÇEK çağrı sırasıyla örtüşüyor mu? ---
  // Bu, köprünün motordan sessizce KAYMASINA karşı asıl korumadır:
  // engine.ts'in sırası değişirse bu kontrol KIRILIR.
  interface Senaryo {
    ad: string;
    avciMove: AvciMove;
    ek: EkHakemMesaji[] | undefined;
    uzmanliklar: Specialization[];
  }
  const senaryolar: Senaryo[] = [
    {
      ad: "yalnız sorHakeme",
      avciMove: { type: "sorHakeme", mesaj: "s1", hakemId: "kullanici-1" },
      ek: undefined,
      uzmanliklar: [],
    },
    {
      ad: "yalnız ek mesaj (kota 1)",
      avciMove: { type: "yakala" },
      ek: [{ mesaj: "e1", hakemId: "sistem" }],
      uzmanliklar: [],
    },
    {
      ad: "sorHakeme + ek mesaj, kota 1 ⇒ ek mesaj DÜŞER",
      avciMove: { type: "sorHakeme", mesaj: "s1", hakemId: "sistem" },
      ek: [{ mesaj: "e1", hakemId: "kullanici-1" }],
      uzmanliklar: [],
    },
    {
      ad: "Arabulucu (kota 2): sorHakeme + ek mesaj İKİSİ de geçer",
      avciMove: { type: "sorHakeme", mesaj: "s1", hakemId: "sistem" },
      ek: [{ mesaj: "e1", hakemId: "kullanici-2" }],
      uzmanliklar: ["arabulucu"],
    },
    {
      ad: "Arabulucu: 2 ek mesaj (hamle hakem kullanmadı)",
      avciMove: { type: "yakala" },
      ek: [
        { mesaj: "e1", hakemId: "kullanici-1" },
        { mesaj: "e2", hakemId: "kullanici-2" },
      ],
      uzmanliklar: ["arabulucu"],
    },
    {
      ad: "düz string ek mesaj (varsayılan hakem ⇒ undefined)",
      avciMove: { type: "yakala" },
      ek: ["e-duz"],
      uzmanliklar: [],
    },
  ];

  for (const s of senaryolar) {
    const state = yeniMac(7, s.uzmanliklar);
    const { kanal, kayit } = kaydedenKanal();
    processTurn(world, state, { type: "kal" }, s.avciMove, kanal, {
      avciHakemMesajlari: s.ek,
    });
    const koprununSirasi = turdakiHakemMesajlari({
      avciMove: s.avciMove,
      avciHakemMesajlari: s.ek,
      avciSpecializations: s.uzmanliklar,
    });
    const esit =
      kayit.length === koprununSirasi.length &&
      kayit.every(
        (k, i) =>
          k.gonderen === koprununSirasi[i].gonderen &&
          k.mesaj === koprununSirasi[i].mesaj &&
          k.hakemId === koprununSirasi[i].hakemId
      );
    kontrol(
      `SIRA EŞLEŞMESİ — ${s.ad}`,
      esit,
      `motor=${JSON.stringify(kayit)} köprü=${JSON.stringify(koprununSirasi)}`
    );
  }

  // Kaçak kanalı bağlanırsa köprü GÜRÜLTÜLÜ başarısız olur.
  let kacakHatasi = "";
  try {
    turdakiHakemMesajlari({
      avciMove: { type: "yakala" },
      avciHakemMesajlari: undefined,
      avciSpecializations: [],
      kacakHakemMesajlari: ["k1"],
    });
  } catch (e) {
    kacakHatasi = e instanceof Error ? e.message : String(e);
  }
  kontrol(
    "kacakHakemMesajlari verilirse köprü HATA verir (sessiz kayma yok)",
    kacakHatasi.includes("DESTEKLENMİYOR"),
    kacakHatasi
  );

  // --- 3) Uçtan uca: ön geçiş + önceden hesaplanmış model + motor -----
  {
    const state = yeniMac(11);
    const panel = macPaneliniKur(11);
    const avciMove: AvciMove = { type: "sorHakeme", mesaj: "What do you know?", hakemId: "kullanici-1" };
    const { ai, cagrilar } = sahteAi((sira) => ({ response: `MODEL-YANITI-${sira}` }));

    const mesajlar = turdakiHakemMesajlari({
      avciMove,
      avciHakemMesajlari: undefined,
      avciSpecializations: [],
    });
    const onGecis = await hakemYanitlariniOnHesapla(
      {
        world,
        state,
        panel,
        dilimBaglami,
        ai,
        modelAdi: "@test/model",
        gecmisCagriSayisi: 0,
        cagriSiniri: 40,
      },
      mesajlar
    );
    kontrol("ön geçiş 1 gerçek çağrı yaptı", onGecis.cagriSayisi === 1 && cagrilar.length === 1);
    kontrol(
      "model adı KODA GÖMÜLÜ değil, ayarlardan geldi",
      cagrilar[0].model === "@test/model",
      cagrilar[0].model
    );
    kontrol(
      "modele giden bağlam system + tek kullanıcı mesajı",
      cagrilar[0].mesajlar.length === 2 &&
        cagrilar[0].mesajlar[0].role === "system" &&
        cagrilar[0].mesajlar[1].content === "What do you know?",
      JSON.stringify(cagrilar[0].mesajlar.map((m) => m.role))
    );

    const onHesaplanmis = onHesaplanmisModelOlustur(onGecis.yanitlar, panel.sistemHakemi.id);
    const toplayici = createOlayToplayici();
    let canliState = state;
    const kanal = macIcinHakemKanaliOlustur(panel, () => canliState, toplayici, {
      sistemModeli: onHesaplanmis.sistemModeli,
      kullaniciOtoYanit: onHesaplanmis.kullaniciOtoYanit,
      // SEED-C: köprü testleri etiketin KENDİSİNİ değil model
      // yanıtlarının motora doğru ulaştığını sınıyor — sabit yer tutucu.
      turEtiketi: "TESTETIKET",
    });
    const sonuc = processTurn(world, canliState, { type: "kal" }, avciMove, kanal, {
      olayToplayici: toplayici,
    });
    canliState = sonuc.state;
    kontrol(
      "motora ULAŞAN yanıt gerçek modelin metni (ön geçişten geldi)",
      icerikAyikla(sonuc.logEntry.hakemMesajlari[0].yanit) === "MODEL-YANITI-0",
      sonuc.logEntry.hakemMesajlari[0].yanit
    );
    kontrol("köprüde eksik yanıt YOK", onHesaplanmis.eksikler.length === 0);
    kontrol("ağ çağrısı SAYISI artmadı (motor yeniden çağırmadı)", cagrilar.length === 1);
  }

  // --- 4) SÜZGEÇ YERİNDE: modelin sızdırdığı başlık motorda ENGELLENİR -
  {
    const state = yeniMac(23);
    const panel = macPaneliniKur(23);
    const avciMove: AvciMove = { type: "sorHakeme", mesaj: "where?", hakemId: "kullanici-1" };
    // En kötü durum: model GERÇEK Kaçak konumunu düz metin söylüyor.
    const { ai } = sahteAi(() => ({ response: `The fugitive is at ${state.kacakPosition}.` }));
    const mesajlar = turdakiHakemMesajlari({
      avciMove,
      avciHakemMesajlari: undefined,
      avciSpecializations: [],
    });
    const onGecis = await hakemYanitlariniOnHesapla(
      { world, state, panel, dilimBaglami, ai, modelAdi: "@test/model", gecmisCagriSayisi: 0, cagriSiniri: 40 },
      mesajlar
    );
    kontrol(
      "ön geçiş HAM metni döner (adaptör/köprü süzmez — süzgeç motorda)",
      [...onGecis.yanitlar.values()][0].includes(state.kacakPosition)
    );

    const onHesaplanmis = onHesaplanmisModelOlustur(onGecis.yanitlar, panel.sistemHakemi.id);
    const toplayici = createOlayToplayici();
    const kanal = macIcinHakemKanaliOlustur(panel, () => state, toplayici, {
      sistemModeli: onHesaplanmis.sistemModeli,
      kullaniciOtoYanit: onHesaplanmis.kullaniciOtoYanit,
      // SEED-C: köprü testleri etiketin KENDİSİNİ değil model
      // yanıtlarının motora doğru ulaştığını sınıyor — sabit yer tutucu.
      turEtiketi: "TESTETIKET",
    });
    const sonuc = processTurn(world, state, { type: "kal" }, avciMove, kanal, {
      olayToplayici: toplayici,
    });
    const yanit = sonuc.logEntry.hakemMesajlari[0].yanit;
    kontrol(
      "SÜZGEÇ bu yolda da YAKALAR: gerçek başlık Avcı'ya ULAŞMADI",
      !yanit.includes(state.kacakPosition),
      yanit
    );
    kontrol(
      "süzgeç olayı maç kaydına yazıldı",
      (sonuc.logEntry.suzgecOlaylari ?? []).some((o) => o.sebep === "baslik"),
      JSON.stringify(sonuc.logEntry.suzgecOlaylari)
    );
  }

  // --- 5) Hazır yanıt bulunamazsa: sabit yanıt + olay, maç DÜŞMEZ -----
  {
    const state = yeniMac(31);
    const panel = macPaneliniKur(31);
    const avciMove: AvciMove = { type: "sorHakeme", mesaj: "q", hakemId: "kullanici-1" };
    // Ön geçiş HİÇ çalıştırılmadı ⇒ boş yanıt haritası.
    const onHesaplanmis = onHesaplanmisModelOlustur(new Map(), panel.sistemHakemi.id);
    const toplayici = createOlayToplayici();
    const kanal = macIcinHakemKanaliOlustur(panel, () => state, toplayici, {
      sistemModeli: onHesaplanmis.sistemModeli,
      kullaniciOtoYanit: onHesaplanmis.kullaniciOtoYanit,
      // SEED-C: köprü testleri etiketin KENDİSİNİ değil model
      // yanıtlarının motora doğru ulaştığını sınıyor — sabit yer tutucu.
      turEtiketi: "TESTETIKET",
    });
    const sonuc = processTurn(world, state, { type: "kal" }, avciMove, kanal, {
      olayToplayici: toplayici,
    });
    kontrol(
      "eksik hazır yanıt ⇒ sabit yanıt",
      icerikAyikla(sonuc.logEntry.hakemMesajlari[0].yanit) === KOPRU_EKSIK_YANIT,
      sonuc.logEntry.hakemMesajlari[0].yanit
    );
    kontrol(
      "eksiklik OLAY olarak kaydedildi",
      onHesaplanmis.eksikler.length === 1 &&
        onHesaplanmis.eksikler[0].hakemId === "kullanici-1" &&
        onHesaplanmis.eksikler[0].sira === 0,
      JSON.stringify(onHesaplanmis.eksikler)
    );
    kontrol("maç DÜŞMEDİ (tur normal işlendi)", sonuc.state.turn === state.turn + 1);
  }

  // --- 6) Çağrı sınırı bu yolda da geçerli: ağa HİÇ çıkılmaz ----------
  {
    const state = yeniMac(41);
    const panel = macPaneliniKur(41);
    const avciMove: AvciMove = { type: "sorHakeme", mesaj: "q", hakemId: "sistem" };
    const { ai, cagrilar } = sahteAi(() => ({ response: "olmamalı" }));
    const onGecis = await hakemYanitlariniOnHesapla(
      {
        world,
        state,
        panel,
        dilimBaglami,
        ai,
        modelAdi: "@test/model",
        gecmisCagriSayisi: 40, // sınıra ULAŞILMIŞ
        cagriSiniri: 40,
      },
      turdakiHakemMesajlari({ avciMove, avciHakemMesajlari: undefined, avciSpecializations: [] })
    );
    kontrol(
      "sınıra ulaşıldıysa ön geçiş AĞA ÇIKMAZ",
      cagrilar.length === 0 && onGecis.cagriSayisi === 0 && onGecis.sinirAtlanan === 1,
      JSON.stringify(onGecis)
    );
  }

  // --- 7) Bilinmeyen hakem id'si: model ÇAĞRILMAZ ---------------------
  {
    const state = yeniMac(43);
    const panel = macPaneliniKur(43);
    const avciMove: AvciMove = { type: "sorHakeme", mesaj: "q", hakemId: "yok-boyle-hakem" };
    const { ai, cagrilar } = sahteAi(() => ({ response: "olmamalı" }));
    const onGecis = await hakemYanitlariniOnHesapla(
      { world, state, panel, dilimBaglami, ai, modelAdi: "@test/model", gecmisCagriSayisi: 0, cagriSiniri: 40 },
      turdakiHakemMesajlari({ avciMove, avciHakemMesajlari: undefined, avciSpecializations: [] })
    );
    kontrol(
      "panelde olmayan hakem ⇒ model çağrısı YOK (motor zaten sabit red döner)",
      cagrilar.length === 0 && onGecis.bilinmeyenHakem === 1,
      JSON.stringify(onGecis)
    );
  }

  // --- 8) Aynı tura aynı SİSTEM hakemine 2 mesaj: 2. girdi 1. yanıtı taşır
  {
    const state = yeniMac(53, ["arabulucu"]);
    const panel = macPaneliniKur(53);
    const avciMove: AvciMove = { type: "sorHakeme", mesaj: "ilk soru", hakemId: "sistem" };
    const ek: EkHakemMesaji[] = [{ mesaj: "ikinci soru", hakemId: "sistem" }];
    const { ai, cagrilar } = sahteAi((sira) => ({ response: `YANIT-${sira}` }));
    const mesajlar = turdakiHakemMesajlari({
      avciMove,
      avciHakemMesajlari: ek,
      avciSpecializations: ["arabulucu"],
    });
    kontrol("Arabulucu ile 2 mesaj köprüye girdi", mesajlar.length === 2, JSON.stringify(mesajlar));

    const onGecis = await hakemYanitlariniOnHesapla(
      { world, state, panel, dilimBaglami, ai, modelAdi: "@test/model", gecmisCagriSayisi: 0, cagriSiniri: 40 },
      mesajlar
    );
    kontrol("2 gerçek çağrı yapıldı", onGecis.cagriSayisi === 2 && cagrilar.length === 2);
    const ikinciBaglam = cagrilar[1].mesajlar;
    kontrol(
      "2. çağrının bağlamı 1. YANITI assistant olarak taşıyor",
      ikinciBaglam.some((m) => m.role === "assistant" && m.content === "YANIT-0"),
      JSON.stringify(ikinciBaglam)
    );
    kontrol(
      "2. çağrının bağlamı 1. SORUYU da taşıyor (biriken konuşma)",
      ikinciBaglam.some((m) => m.role === "user" && m.content === "ilk soru") &&
        ikinciBaglam.some((m) => m.role === "user" && m.content === "ikinci soru"),
      JSON.stringify(ikinciBaglam.map((m) => `${m.role}:${m.content}`))
    );

    // Eşleştirme (hakemId, sıra) ile: motor ikisini DOĞRU sırada alır.
    const onHesaplanmis = onHesaplanmisModelOlustur(onGecis.yanitlar, panel.sistemHakemi.id);
    const toplayici = createOlayToplayici();
    const kanal = macIcinHakemKanaliOlustur(panel, () => state, toplayici, {
      sistemModeli: onHesaplanmis.sistemModeli,
      kullaniciOtoYanit: onHesaplanmis.kullaniciOtoYanit,
      // SEED-C: köprü testleri etiketin KENDİSİNİ değil model
      // yanıtlarının motora doğru ulaştığını sınıyor — sabit yer tutucu.
      turEtiketi: "TESTETIKET",
    });
    const sonuc = processTurn(world, state, { type: "kal" }, avciMove, kanal, {
      avciHakemMesajlari: ek,
      olayToplayici: toplayici,
    });
    const yanitlar = sonuc.logEntry.hakemMesajlari.map((m) => icerikAyikla(m.yanit));
    kontrol(
      "motor iki yanıtı SIRAYLA aldı (eksik/karışma yok)",
      yanitlar.length === 2 && yanitlar[0] === "YANIT-0" && yanitlar[1] === "YANIT-1",
      JSON.stringify(yanitlar)
    );
    kontrol("eksik yanıt olayı YOK", onHesaplanmis.eksikler.length === 0);
  }

  // --- 9) Model hatası/zaman aşımı yedeği bu yolda da geçerli ---------
  {
    const state = yeniMac(61);
    const panel = macPaneliniKur(61);
    const avciMove: AvciMove = { type: "sorHakeme", mesaj: "q", hakemId: "kullanici-1" };
    const patlayanAi = {
      run(): Promise<unknown> {
        return Promise.reject(new Error("ağ koptu — GİZLİ HATA AYIKLAMA İZİ"));
      },
    };
    const onGecis = await hakemYanitlariniOnHesapla(
      {
        world,
        state,
        panel,
        dilimBaglami,
        ai: patlayanAi,
        modelAdi: "@test/model",
        gecmisCagriSayisi: 0,
        cagriSiniri: 40,
      },
      turdakiHakemMesajlari({ avciMove, avciHakemMesajlari: undefined, avciSpecializations: [] })
    );
    const tekYanit = [...onGecis.yanitlar.values()][0];
    kontrol(
      "model hatasında sabit yanıt (adaptörün yedeği köprüde de çalışıyor)",
      tekYanit === MODEL_HATASI_SABIT_YANITI,
      tekYanit
    );
    kontrol("ham hata metni SIZMIYOR", !tekYanit.includes("GİZLİ HATA AYIKLAMA İZİ"));
  }

  // --- 10) "sahte" mod: seçenek verilmezse G4A davranışı AYNEN -------
  {
    const state = yeniMac(71);
    const panel = macPaneliniKur(71);
    const toplayici = createOlayToplayici();
    const kanal = macIcinHakemKanaliOlustur(panel, () => state, toplayici, {
      turEtiketi: "TESTETIKET",
    });
    const sonuc = processTurn(
      world,
      state,
      { type: "kal" },
      { type: "sorHakeme", mesaj: "What do you know?", hakemId: "kullanici-1" },
      kanal,
      { olayToplayici: toplayici }
    );
    kontrol(
      "sahte mod (seçeneksiz) hâlâ uyumluModel şablonunu üretiyor",
      /^As far as I know, the \w+ is /.test(icerikAyikla(sonuc.logEntry.hakemMesajlari[0].yanit)),
      sonuc.logEntry.hakemMesajlari[0].yanit
    );
  }

  console.log("");
  if (failures > 0) {
    console.log(`✗ ${failures} kontrol BAŞARISIZ.`);
    process.exit(1);
  }
  console.log("✓ Tüm model köprüsü testleri geçti.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
