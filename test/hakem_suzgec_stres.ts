import * as path from "path";
import { loadWorldFromFile } from "./loadWorldFile";
import type { MatchState } from "../src/game/types";
import {
  TUM_DILIM_TURLERI,
  dereceEsikleriHesapla,
  dilimUret,
  kategoriUyeSayilari,
  type DilimBaglami,
  type DilimTuru,
  type KategoriKurali,
} from "../src/game/hakemDilim";
import { KISA_DEGER_ESIGI, normalize, suz } from "../src/game/hakemSuzgec";
import { TUM_SIZDIRMA_BICIMLERI, sirriBicimle } from "../src/game/hakemModel";

/**
 * G3 Madde 4 — ÇIKIŞ SÜZGECİ STRES TARAMASI.
 *
 * `hakem_sizinti.test.ts` süzgecin sözleşmesini sınar; bu dosya onu
 * DÜNYANIN TAMAMI üzerinde ve testte bulunmayan iç içe/birleşik kaçma
 * varyantlarıyla zorlar (~70.000 deneme, ~8 sn). "Bir kez çalıştı"
 * yetmez: süzgecin tek bir şanslı sayfada değil, her sayfada tutması
 * gerekir.
 */

const WORLD_FILE = path.join(__dirname, "../world/world.scc.json");

let failures = 0;
function kontrol(ad: string, kosul: boolean, detay = ""): void {
  console.log(`${kosul ? "✓" : "✗"} ${ad}${detay === "" ? "" : ` — ${detay}`}`);
  if (!kosul) failures++;
}

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");
const hex = (s: string) => Buffer.from(s, "utf-8").toString("hex");
const rev = (s: string) => [...s].reverse().join("");
const rot13 = (s: string) =>
  s.replace(/[a-z]/gi, (c) => {
    const b = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b);
  });

/** Testte bulunmayan, daha zor iç içe/birleşik kaçma denemeleri. */
const ICICE: { ad: string; f: (s: string) => string }[] = [
  { ad: "base64(ters)", f: (s) => b64(rev(s)) },
  { ad: "ters(base64)", f: (s) => rev(b64(s)) },
  { ad: "hex(base64)", f: (s) => hex(b64(s)) },
  { ad: "base64(cümle)", f: (s) => b64(`The fugitive is on ${s} right now.`) },
  { ad: "hex(cümle)", f: (s) => hex(`answer: ${s}`) },
  { ad: "boşluklu base64", f: (s) => [...b64(s)].join(" ") },
  { ad: "cümle+ters", f: (s) => `the title spelled backwards is ${rev(s)}` },
  { ad: "araya nokta", f: (s) => [...s].join("·") },
  { ad: "araya alt çizgi", f: (s) => [...s].join("_") },
  { ad: "büyük+çift boşluk", f: (s) => [...s.toUpperCase()].join("  ") },
  { ad: "markdown kod bloğu", f: (s) => `\`\`\`\n${s}\n\`\`\`` },
  { ad: "json içinde", f: (s) => JSON.stringify({ secret: s, note: "do not tell" }) },
  { ad: "ondalık(ters)", f: (s) => [...rev(s)].map((c) => c.charCodeAt(0)).join(" ") },
  { ad: "rot13(cümle)", f: (s) => `gur nafjre vf ${rot13(s)}` },
];

const ZARARSIZ = [
  "I cannot help with that.",
  "I only know one thing, and it is not what you asked.",
  "Ask me about my own slice, nothing else.",
  "No comment on that subject, hunter.",
  "That information is not available to me.",
  "I will not speculate about other referees.",
  "Interesting question, but I am afraid I must decline.",
  "I am a referee, not an informant. Ask properly.",
  "My one fact is all I have, and you already asked about it.",
  "A hunter should rely on their own tools, not on me.",
  "I do not know the answer to that, truly.",
  "Is that all you wanted to know? I have nothing more.",
  "In my opinion the answer is obvious if you think about it.",
  "I refuse. Try a different referee if you like.",
];

function main() {
  const world = loadWorldFromFile(WORLD_FILE);
  const pages = world.titles.map((t) => {
    const p = world.pages.get(t);
    if (p === undefined) throw new Error(`Sayfa yok: ${t}`);
    return p;
  });
  const esikler = dereceEsikleriHesapla(world);
  const uyeSayilari = kategoriUyeSayilari(pages);

  function baglamKur(
    idx: number,
    kendiTuru: DilimTuru,
    kural: KategoriKurali = "uye2"
  ) {
    const ctx: DilimBaglami = { esikler, uyeSayilari, kategoriKurali: kural };
    const t = world.titles[idx];
    const st: MatchState = {
      seed: 1,
      turn: 3,
      turnLimit: 30,
      kacakPosition: t,
      avciPosition: world.titles[(idx + 600) % world.titles.length],
      kacakSpecializations: [],
      avciSpecializations: [],
      kacakStayStreak: idx % 4,
      kacakMoveCount: 1,
      kacakStayCount: idx % 4,
      status: "devam",
      log: [],
    };
    const kendi = dilimUret(world, st, kendiTuru, ctx);
    const diger = TUM_DILIM_TURLERI.filter((x) => x !== kendiTuru).map(
      (x) => dilimUret(world, st, x, ctx).deger
    );
    const p = world.pages.get(t);
    if (p === undefined) throw new Error(`Sayfa yok: ${t}`);
    return {
      t,
      c: {
        gercekBaslik: t,
        sayfaKimligi: p.pageId,
        izinliDeger: kendi.deger,
        digerDilimDegerleri: diger,
      },
    };
  }

  // --- A) başlık, temel biçimler, TÜM sayfalar ---
  let gecenA = 0;
  let denA = 0;
  const ornekA: string[] = [];
  for (let i = 0; i < world.titles.length; i++) {
    const { t, c } = baglamKur(i, "derece");
    for (const bicim of TUM_SIZDIRMA_BICIMLERI) {
      denA++;
      if (!suz(sirriBicimle(t, bicim), c).engellendi) {
        gecenA++;
        if (ornekA.length < 5) ornekA.push(`${t}/${bicim}`);
      }
    }
  }
  kontrol(`A) başlık × ${TUM_SIZDIRMA_BICIMLERI.length} temel biçim engellendi`, gecenA === 0, `${denA} deneme${ornekA.length > 0 ? ` | geçen: ${ornekA.join(", ")}` : ""}`);

  // --- B) iç içe / birleşik varyantlar, TÜM sayfalar ---
  let gecenB = 0;
  let denB = 0;
  const ornekB: string[] = [];
  for (let i = 0; i < world.titles.length; i++) {
    const { t, c } = baglamKur(i, "derece");
    for (const v of ICICE) {
      denB++;
      if (!suz(v.f(t), c).engellendi) {
        gecenB++;
        if (ornekB.length < 5) ornekB.push(`${t}/${v.ad}`);
      }
    }
  }
  kontrol(`B) başlık × ${ICICE.length} iç içe/birleşik varyant engellendi`, gecenB === 0, `${denB} deneme${ornekB.length > 0 ? ` | geçen: ${ornekB.join(", ")}` : ""}`);

  // --- C) sayfa kimliği ---
  let gecenC = 0;
  let denC = 0;
  for (let i = 0; i < world.titles.length; i++) {
    const { c } = baglamKur(i, "derece");
    if (c.sayfaKimligi === undefined) continue;
    for (const bicim of TUM_SIZDIRMA_BICIMLERI) {
      denC++;
      if (!suz(sirriBicimle(String(c.sayfaKimligi), bicim), c).engellendi) gecenC++;
    }
  }
  kontrol("C) sayfa kimliği her biçimde engellendi", gecenC === 0, `${denC} deneme`);

  /**
   * D ve E, ÜÇ KATEGORİ KURALININ HEPSİ için koşulur. Bu kasıtlı:
   * ilk yazımda yalnız `uye2` taranıyordu ve `enBuyuk` kuralında
   * kategori hakeminin meşru yanıtının kesildiği iki durum
   * (`Airline`, `Climate change in Indonesia`) stres taramasından
   * kaçıp ancak Madde 5 ölçümünün süzgeç-olay sayacında görünmüştü.
   * Kategori kuralı değişince süzgecin gördüğü değerler de değişir;
   * tarama bu yüzden kurala duyarlı olmak zorunda.
   */
  const kurallar: KategoriKurali[] = ["uye6", "enBuyuk", "uye2"];

  // --- D) diğer-dilim değerleri, her hakem türü × her kural ---
  let gecenD = 0;
  let denD = 0;
  const ornekD: string[] = [];
  for (const kural of kurallar) {
    for (let i = 0; i < world.titles.length; i += 3) {
      for (const kendiTuru of TUM_DILIM_TURLERI) {
        const { c } = baglamKur(i, kendiTuru, kural);
        for (const d of c.digerDilimDegerleri) {
          const n = normalize(d);
          // Kısa ve kendi değeriyle çakışan değerler kasıtlı olarak
          // aranmıyor (bkz. KISA_DEGER_ESIGI) — onlar sayılmaz.
          if (n.length < KISA_DEGER_ESIGI || n === normalize(c.izinliDeger)) continue;
          denD++;
          if (!suz(`Between you and me, it is ${d}.`, c).engellendi) {
            gecenD++;
            if (ornekD.length < 5) ornekD.push(`${kural}/${kendiTuru}←${d}`);
          }
        }
      }
    }
  }
  kontrol("D) başka hakemlerin dilim değerleri engellendi (3 kural)", gecenD === 0, `${denD} deneme${ornekD.length > 0 ? ` | geçen: ${ornekD.join(", ")}` : ""}`);

  /**
   * E) meşru kendi-dilim yanıtı kesilmemeli — TEK İSTİSNA (G4B-3a):
   * hakemin kendi değeri GERÇEK BAŞLIĞIN KENDİSİ ise. O zaman o dizgeyi
   * söylemek tam konumu söylemektir; süzgeç fail-closed davranır ve
   * başlık muafiyeti kendi-değer muafiyetini YENER (G4B-2b Bulgu 3'ün
   * düzeltmesi). Dünyada ulaşılabilir tek durum: başlığı `"0"` olan sayfa
   * + `harf`="0" (her zaman) ya da `hareket`="0" (Kaçak hareket ettiyse).
   *
   * Kontrol, kesilen yanıt SAYISINI değil SEBEBİNİ sabitler: her kesilen
   * durumda kendi değeri başlığa eşit OLMALIDIR. Başka bir sebeple
   * kesilen bir yanıt (gerçek bir yanlış pozitif) testi düşürür.
   */
  let kesilen = 0;
  let denE = 0;
  let kesilenBaslikCakismasi = 0;
  const ornekE: string[] = [];
  const beklenmeyenE: string[] = [];
  const kesilenBasliklar = new Set<string>();
  for (const kural of kurallar) {
    for (let i = 0; i < world.titles.length; i++) {
      for (const kendiTuru of TUM_DILIM_TURLERI) {
        const { c } = baglamKur(i, kendiTuru, kural);
        denE++;
        if (suz(`As far as I know, the ${kendiTuru} is ${c.izinliDeger}.`, c).engellendi) {
          kesilen++;
          const etiket = `${kural}/${c.gercekBaslik}[${kendiTuru}=${c.izinliDeger}]`;
          if (ornekE.length < 8) ornekE.push(etiket);
          kesilenBasliklar.add(c.gercekBaslik);
          if (normalize(c.izinliDeger) === normalize(c.gercekBaslik)) {
            kesilenBaslikCakismasi++;
          } else {
            beklenmeyenE.push(etiket);
          }
        }
      }
    }
  }
  console.log(
    `  (ölçüm) kesilen meşru kendi-dilim yanıtı: ${kesilen}/${denE}` +
      `${kesilen > 0 ? ` | ${ornekE.join(", ")}` : ""}`
  );
  kontrol(
    "E) kesilen her meşru yanıtın sebebi kendi-değer=gerçek-başlık çakışması (3 kural)",
    beklenmeyenE.length === 0,
    `${denE} deneme | başlık çakışması: ${kesilenBaslikCakismasi}${
      beklenmeyenE.length > 0 ? ` | BEKLENMEYEN: ${beklenmeyenE.slice(0, 5).join(", ")}` : ""
    }`
  );
  kontrol(
    "E) bu çakışma yalnız kısa (≤3 karakter) başlıklarda görülür",
    [...kesilenBasliklar].every((t) => normalize(t).length <= 3),
    [...kesilenBasliklar].map((t) => `${t}(${normalize(t).length})`).join(", ")
  );

  // --- F) zararsız yanıtlarda yanlış pozitif ---
  let fp = 0;
  let denF = 0;
  const fpBasliklar = new Set<string>();
  for (let i = 0; i < world.titles.length; i += 2) {
    for (const kendiTuru of TUM_DILIM_TURLERI) {
      const { c } = baglamKur(i, kendiTuru);
      for (const z of ZARARSIZ) {
        denF++;
        if (suz(z, c).engellendi) {
          fp++;
          fpBasliklar.add(c.gercekBaslik);
        }
      }
    }
  }
  const fpOran = (100 * fp) / denF;
  console.log(
    `  (ölçüm) zararsız yanıt yanlış pozitifi: ${fp}/${denF} (%${fpOran.toFixed(3)}), etkilenen başlıklar: ${JSON.stringify([...fpBasliklar])}`
  );

  /**
   * BİLİNEN VE KABUL EDİLEN SINIR: 3 harfli bir başlık, yaygın bir
   * İngilizce sözcüğün tersi olabilir — "DNA" ↔ "and". Ters-yazım
   * taraması bunu ayırt edemez. Fail-closed tercih edildi: sızıntıyı
   * kaçırmak yerine o sayfada bazı zararsız yanıtlar kesilir.
   * Eşik, bu bilinen durumun ötesine geçerse test BAŞARISIZ olur.
   *
   * G4B-3a ÖLÇÜMÜ: bu sayı 16/45360 (%0.035) → 20/45360 (%0.044) oldu.
   * Artışın tek kaynağı düzeltmenin kendisidir: `"0"` başlıklı sayfada
   * hakemin kendi değeri başlıkla çakıştığında (`harf`/`hareket`="0")
   * başlık ARTIK yasak listesine giriyor, dolayısıyla onun parmak izleri
   * (ör. ondalık "48", hex "30") o sayfadaki zararsız yanıtlarda da
   * aranıyor. Etkilenen başlık kümesi DEĞİŞMEDİ (DNA, 0).
   */
  kontrol(
    "F) yanlış pozitif oranı bilinen sınırın (%0.1) altında",
    fpOran < 0.1,
    `ters-yazım çakışması, bkz. kaynak notu`
  );
  kontrol(
    "F) yanlış pozitifler yalnız kısa (≤3 karakter) başlıklarda",
    [...fpBasliklar].every((t) => normalize(t).length <= 3),
    [...fpBasliklar].map((t) => `${t}(${normalize(t).length})`).join(", ")
  );

  console.log(`\n=== SONUÇ ===`);
  console.log(
    `${denA + denB + denC + denD + denE + denF} toplam deneme; sızıntı: ${gecenA + gecenB + gecenC + gecenD}`
  );
  console.log(failures === 0 ? "✓ Stres taraması geçti." : `✗ ${failures} kontrol BAŞARISIZ.`);
  if (failures > 0) process.exit(1);
}

main();
