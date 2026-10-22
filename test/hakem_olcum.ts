import * as path from "path";
import { loadWorldFromFile } from "./loadWorldFile";
import { setupMatch, DEFAULT_TURN_LIMIT } from "../src/game/setup";
import { processTurn, type EkHakemMesaji } from "../src/game/engine";
import { avciView, kacakView } from "../src/game/views";
import { createRng } from "../src/game/rng";
import { distance, type WorldData } from "../src/game/world";
import type {
  AvciMove,
  HakemYanitKaydi,
  MatchState,
  PageTitle,
  Specialization,
  WorldPage,
} from "../src/game/types";
import {
  dereceEsikleriHesapla,
  dilimeUyanSayfalar,
  kategoriUyeSayilari,
  type Dilim,
  type DilimBaglami,
  type DilimTuru,
  type KategoriKurali,
} from "../src/game/hakemDilim";
import { hakemPaneliKur, type HakemAtamasi } from "../src/game/hakemPanel";
import { modelGirdisiKur, uyumluModel } from "../src/game/hakemModel";
import { createOlayToplayici } from "../src/game/hakemSuzgec";
import { createBellekKullaniciKanali, createPanelKanali } from "../src/game/hakemKanali";
import { stayKacak, wanderingKacak, type KacakBotFn } from "./bots/kacakBots";

/**
 * G3 Madde 5 — KISA ÖLÇÜM.
 *
 * G2C/G2D'den temel fark: hakem Q&A artık ÖLÇÜM STUB'I ÜZERİNDEN DEĞİL,
 * **üretim hakem katmanının tamamından** geçiyor — tohumlu panel
 * kurulumu, dilim ataması, model arayüzü (uyumlu sahte model) ve çıkış
 * süzgeci dahil. Avcı bu yüzden ham dilim değeri değil, serbest metin
 * bir yanıt alır ve onu AYRIŞTIRMAK zorundadır.
 *
 * Kategori kuralı DeeOne'ın kararını beklediği için (bkz. Madde 1 DUR
 * raporu) üç kural da ölçülür — ölçüm, kararı önceden vermez.
 */

const WORLD_FILE = path.join(__dirname, "../world/world.scc.json");
/** Varsayılan 300 (goal). Hızlı doğrulama için: AK_SEEDS=10 tsx ... */
const N_SEEDS = (() => {
  const ham = process.env.AK_SEEDS;
  if (ham === undefined) return 300;
  const n = Number(ham);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`AK_SEEDS tam sayı ve >0 olmalı, "${ham}" verildi.`);
  }
  return n;
})();

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Uyumlu modelin yanıtından dilim değerini ayrıştırır.
 * Şablon: "As far as I know, the <tur> is <deger>."
 * Ayrıştırılamazsa (süzgeç kesmişse, hakem suskunsa) undefined.
 */
export function yanitAyristir(tur: DilimTuru, yanit: string): string | undefined {
  const onEk = `As far as I know, the ${tur} is `;
  if (!yanit.startsWith(onEk)) return undefined;
  const geri = yanit.slice(onEk.length);
  return geri.endsWith(".") ? geri.slice(0, -1) : geri;
}

interface OlcumAvcisi {
  buTurSorulacaklar(): { hakem: HakemAtamasi; mesaj: string }[];
  yanitlariIsle(sorulanlar: { hakem: HakemAtamasi }[], yeniKayitlar: HakemYanitKaydi[]): void;
  kararVer(view: ReturnType<typeof avciView>): AvciMove;
  ayristirilamayanSayisi(): number;
}

/**
 * Biriktiren Avcı (G2D "birleşik" modu): öğrendiği her dilim değerini
 * maç boyunca SAKLAR. G2D'nin bulgusu buydu — bilgiyi atmak, hedef
 * hareketsizken bile başlı başına bir cezaydı.
 *
 * Madde 2 (G4B-1b) DÜZELTMESİ: `bolge` dilimi SORUNUN SORULDUĞU
 * ANDAKİ Avcı konumuna göre üretilir (bkz. `HakemYanitKaydi.avciKonum`
 * notu, types.ts) — bu ÖLÇÜM script'i ÖNCEDEN `view.kendiKonum`
 * (GÜNCEL konum, sorudan SONRAKİ turlarda farklı olabilir) ile
 * yeniden süzüyordu. Artık her bilinen değer, üretildiği anki
 * `avciKonum`'u da TAŞIR; `bolge` için süzme O konumla yapılır.
 */
function createOlcumAvcisi(
  world: WorldData,
  pages: readonly WorldPage[],
  aktifHakemler: readonly HakemAtamasi[],
  K: number,
  ctx: DilimBaglami
): OlcumAvcisi {
  const bilinen = new Map<DilimTuru, { deger: string; avciKonum: PageTitle }>();
  let rr = 0;
  let ayristirilamayan = 0;

  return {
    buTurSorulacaklar() {
      if (aktifHakemler.length === 0) return [];
      const liste: { hakem: HakemAtamasi; mesaj: string }[] = [];
      const adet = Math.min(K, aktifHakemler.length);
      for (let i = 0; i < adet; i++) {
        const hakem = aktifHakemler[(rr + i) % aktifHakemler.length];
        liste.push({ hakem, mesaj: `What is the ${hakem.dilimTuru}?` });
      }
      rr = (rr + adet) % aktifHakemler.length;
      return liste;
    },

    yanitlariIsle(sorulanlar, yeniKayitlar) {
      for (let i = 0; i < sorulanlar.length && i < yeniKayitlar.length; i++) {
        const tur = sorulanlar[i].hakem.dilimTuru;
        const kayit = yeniKayitlar[i];
        const deger = yanitAyristir(tur, kayit.yanit);
        if (deger === undefined) {
          ayristirilamayan++;
          continue;
        }
        // Eski (avciKonum'suz) kayıtlarda güvenli düşüş yok burada —
        // bu script HER ZAMAN üretim motorunun GERÇEK çıktısını okur
        // (engine.ts her yanıta avciKonum ekler, bkz. types.ts).
        bilinen.set(tur, { deger, avciKonum: kayit.avciKonum ?? "" });
      }
    },

    kararVer(view): AvciMove {
      let adaylar: readonly WorldPage[] = pages;
      for (const [tur, { deger, avciKonum }] of bilinen) {
        const dilim: Dilim = { tur, deger };
        adaylar = dilimeUyanSayfalar(world, adaylar, dilim, {
          ...ctx,
          // Madde 2: `bolge` SORUNUN SORULDUĞU ANDAKİ konuma göredir
          // (avciKonum) — GÜNCEL konum (view.kendiKonum) DEĞİL.
          avciPos: tur === "bolge" ? avciKonum : view.kendiKonum,
        });
      }

      if (adaylar.some((p) => p.title === view.kendiKonum)) {
        return { type: "yakala" };
      }

      let hedef: PageTitle | null = null;
      let enIyi = Infinity;
      for (const a of adaylar) {
        const d = distance(world, view.kendiKonum, a.title) ?? Infinity;
        if (d < enIyi) {
          enIyi = d;
          hedef = a.title;
        }
      }
      if (hedef === null || view.komsular.length === 0) return { type: "yakala" };

      let enIyiKomsu: PageTitle | null = null;
      let enIyiKomsuD = Infinity;
      for (const k of view.komsular) {
        const d = distance(world, k, hedef) ?? Infinity;
        if (d < enIyiKomsuD) {
          enIyiKomsuD = d;
          enIyiKomsu = k;
        }
      }
      if (enIyiKomsu === null) return { type: "yakala" };
      return { type: "git", to: enIyiKomsu };
    },

    ayristirilamayanSayisi() {
      return ayristirilamayan;
    },
  };
}

interface MacSonucu {
  status: MatchState["status"];
  turnsPlayed: number;
  ayristirilamayan: number;
  suzgecOlayi: number;
}

function macOynat(
  world: WorldData,
  pages: readonly WorldPage[],
  seed: number,
  kacakBot: KacakBotFn,
  N: number,
  K: number,
  ctx: DilimBaglami
): MacSonucu {
  // K=2 üretim kotası için Arabulucu beyanı gerekir (taban kota 1).
  const avciSpecializations: Specialization[] = K >= 2 ? ["arabulucu"] : [];
  let state = setupMatch(world, {
    seed,
    kacakSpecializations: [],
    avciSpecializations,
    turnLimit: DEFAULT_TURN_LIMIT,
  });

  // SPEC §6: panel en az 2 (1 sistem + ≥1 kullanıcı). N dilim için
  // panel büyüklüğü max(2, N); Avcı ilk N FARKLI dilim türünü sorar.
  const panel = hakemPaneliKur(seed, Math.max(2, N));
  const gorulen = new Set<DilimTuru>();
  const aktifHakemler: HakemAtamasi[] = [];
  for (const h of panel.hakemler) {
    if (gorulen.has(h.dilimTuru)) continue;
    gorulen.add(h.dilimTuru);
    aktifHakemler.push(h);
    if (aktifHakemler.length >= N) break;
  }

  const toplayici = createOlayToplayici();
  const kanal = createPanelKanali({
    world,
    getState: () => state,
    panel,
    dilimBaglami: ctx,
    sistemModeli: uyumluModel,
    /**
     * Kullanıcı hakemleri de uyumlu model gibi, pencere içinde ve
     * dürüstçe yanıt verir — bu ölçümün üst sınırıdır ("tüm hakemler
     * dürüst"). Suskun/kötü niyetli hakem davranışı Madde 3-4
     * testlerinde ayrıca sınandı. Dilimi gelen kutusundan okur.
     */
    kullaniciKanali: createBellekKullaniciKanali({
      otoYanit: (m) =>
        uyumluModel(modelGirdisiKur(m.dilim, [{ gonderen: m.gonderen, metin: m.metin }])),
    }),
    olayYaz: toplayici.yaz,
    // SEED-C: bu ölçüm etiketin KENDİSİNİ değil hakem davranışını
    // ölçüyor — sabit bir yer tutucu yeterli.
    turEtiketi: "OLCUMETIKETI",
  });

  const botRng = createRng(seed);
  const avci = createOlcumAvcisi(world, pages, aktifHakemler, K, ctx);
  const GUVENLIK = state.turnLimit + 10;
  let dongu = 0;
  let suzgecOlayi = 0;

  while (state.status === "devam" && dongu < GUVENLIK) {
    const kMove = kacakBot(kacakView(world, state), botRng);

    // Soru bu turda sorulur; yanıtı ancak processTurn döndükten SONRA
    // bilinir — yani karar HER ZAMAN önceki turların bilgisine dayanır
    // (SPEC §7 tur sırası; G2D ile aynı 1-tur gecikmesi).
    const sorulacaklar = avci.buTurSorulacaklar();
    const aMove = avci.kararVer(avciView(world, state));

    const ekMesajlar: EkHakemMesaji[] = sorulacaklar.map((s) => ({
      mesaj: s.mesaj,
      hakemId: s.hakem.id,
    }));

    const buTurunNumarasi = state.turn;
    const sonuc = processTurn(world, state, kMove, aMove, kanal, {
      avciHakemMesajlari: ekMesajlar,
      olayToplayici: toplayici,
    });

    // Madde 2: `avciKonum` (sorunun sorulduğu anki Avcı konumu) YALNIZ
    // `state.avciHakemYanitlari`de bulunur — `logEntry.hakemMesajlari`
    // (eski okuma yeri) bu alanı TAŞIMAZ.
    const yeniKayitlar = (sonuc.state.avciHakemYanitlari ?? []).filter(
      (y) => y.turn === buTurunNumarasi
    );
    avci.yanitlariIsle(sorulacaklar, yeniKayitlar);
    suzgecOlayi += (sonuc.logEntry.suzgecOlaylari ?? []).length;

    state = sonuc.state;
    dongu++;
  }

  return {
    status: state.status,
    turnsPlayed: state.turn - 1,
    ayristirilamayan: avci.ayristirilamayanSayisi(),
    suzgecOlayi,
  };
}

function main() {
  console.log(`Dünya yükleniyor: ${WORLD_FILE}`);
  const world = loadWorldFromFile(WORLD_FILE);
  const pages = world.titles.map((t) => {
    const p = world.pages.get(t);
    if (p === undefined) throw new Error(`Sayfa yok: ${t}`);
    return p;
  });
  console.log(`${pages.length} sayfa (SCC) yüklendi. ${N_SEEDS} tohum/hücre.\n`);

  // Dünya başına bir kez hesaplanır (maç başına hesaplamak ölçümü
  // gereksiz yere dakikalarca yavaşlatıyordu).
  const esikler = dereceEsikleriHesapla(world);
  const uyeSayilari = kategoriUyeSayilari(pages);

  const kurallar: KategoriKurali[] = ["uye6", "enBuyuk", "uye2"];
  const Ns = [1, 2, 3, 4, 5];
  const Ks = [1, 2];
  const kacaklar: { ad: string; fn: KacakBotFn }[] = [
    { ad: "kal", fn: stayKacak },
    { ad: "rastgeleGezen", fn: wanderingKacak },
  ];

  console.log(
    `Kural    N  K  Kaçak           Kazanma%  OrtTur  Ayrıştırılamayan/maç  Süzgeç olayı`
  );

  const satirlar: {
    kural: KategoriKurali;
    N: number;
    K: number;
    kacak: string;
    winRate: number;
    avgTurns: number;
  }[] = [];

  for (const kural of kurallar) {
    const ctx: DilimBaglami = { esikler, uyeSayilari, kategoriKurali: kural };
    for (const N of Ns) {
      for (const K of Ks) {
        for (const kacak of kacaklar) {
          let wins = 0;
          const turlar: number[] = [];
          let ayristirilamayan = 0;
          let olaylar = 0;
          for (let seed = 0; seed < N_SEEDS; seed++) {
            const m = macOynat(world, pages, seed, kacak.fn, N, K, ctx);
            if (m.status === "avciKazandi") wins++;
            turlar.push(m.turnsPlayed);
            ayristirilamayan += m.ayristirilamayan;
            olaylar += m.suzgecOlayi;
          }
          const winRate = wins / N_SEEDS;
          satirlar.push({ kural, N, K, kacak: kacak.ad, winRate, avgTurns: mean(turlar) });
          console.log(
            `${kural.padEnd(9)}${String(N).padEnd(3)}${String(K).padEnd(3)}${kacak.ad.padEnd(16)}%${(winRate * 100).toFixed(1).padStart(6)}  ${mean(turlar).toFixed(1).padStart(6)}  ${(ayristirilamayan / N_SEEDS).toFixed(2).padStart(20)}  ${String(olaylar).padStart(12)}`
          );
        }
      }
    }
  }

  console.log(`\n=== %20–60 hedef aralığı (ZORLANMADI, yalnız raporlanıyor) ===`);
  const icinde = satirlar.filter((r) => r.winRate >= 0.2 && r.winRate <= 0.6);
  console.log(`Aralık içinde: ${icinde.length}/${satirlar.length} hücre`);
  for (const r of icinde) {
    console.log(
      `  ${r.kural} N=${r.N} K=${r.K} ${r.kacak}: %${(r.winRate * 100).toFixed(1)}`
    );
  }

  console.log(`\n=== Kural başına özet (tüm N,K ortalaması) ===`);
  for (const kural of kurallar) {
    for (const kacak of kacaklar) {
      const alt = satirlar.filter((r) => r.kural === kural && r.kacak === kacak.ad);
      console.log(
        `  ${kural.padEnd(9)} ${kacak.ad.padEnd(16)} ortalama kazanma %${(mean(alt.map((r) => r.winRate)) * 100).toFixed(1)}`
      );
    }
  }
}

main();
