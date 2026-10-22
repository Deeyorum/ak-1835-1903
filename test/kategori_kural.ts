import * as path from "path";
import { loadWorldFromFile } from "./loadWorldFile";
import type { PageTitle, WorldPage } from "../src/game/types";
import {
  DIGER,
  kategoriDilimi,
  kategoriUyeSayilari,
  kategoriBasligiSizdiriyor,
  type KategoriKurali,
} from "../src/game/hakemDilim";

/**
 * G3 Madde 1: kategori dilimi kuralının ÖLÇÜLEREK seçilmesi.
 *
 * Ölçüt (goal): "diğer" payı ≤%25 VE kategori-tek-başına medyan aday
 * sayısı 20–150 bandında. Hiçbir kural sağlamazsa DUR ve raporla.
 */

const WORLD_FILE = path.join(__dirname, "../world/world.scc.json");

const DIGER_UST_SINIR = 0.25;
const MEDYAN_ALT = 20;
const MEDYAN_UST = 150;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function p90(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
}

interface KuralOlcumu {
  kural: KategoriKurali;
  digerSayisi: number;
  digerPayi: number;
  medyanTum: number;
  medyanDigerHaric: number;
  p90Tum: number;
  benzersizDegerSayisi: number;
}

function olcKural(pages: WorldPage[], uyeSayilari: Map<string, number>, kural: KategoriKurali): KuralOlcumu {
  const deger = new Map<PageTitle, string>();
  const kova = new Map<string, number>();
  for (const p of pages) {
    const v = kategoriDilimi(p, uyeSayilari, kural);
    deger.set(p.title, v);
    kova.set(v, (kova.get(v) ?? 0) + 1);
  }

  const tum: number[] = [];
  const digerHaric: number[] = [];
  let digerSayisi = 0;
  for (const p of pages) {
    const v = deger.get(p.title);
    if (v === undefined) throw new Error(`olcKural: ${p.title} için değer yok`);
    const n = kova.get(v);
    if (n === undefined) throw new Error(`olcKural: ${v} için kova yok`);
    tum.push(n);
    if (v === DIGER) digerSayisi++;
    else digerHaric.push(n);
  }

  return {
    kural,
    digerSayisi,
    digerPayi: digerSayisi / pages.length,
    medyanTum: median(tum),
    medyanDigerHaric: median(digerHaric),
    p90Tum: p90(tum),
    benzersizDegerSayisi: kova.size,
  };
}

function main() {
  const world = loadWorldFromFile(WORLD_FILE);
  const pages = world.titles.map((t) => {
    const p = world.pages.get(t);
    if (p === undefined) throw new Error(`Sayfa bulunamadı: ${t}`);
    return p;
  });
  const uyeSayilari = kategoriUyeSayilari(pages);

  console.log(`=== G3 Madde 1: Kategori Kuralı Seçimi (SCC, ${pages.length} sayfa) ===\n`);
  console.log(`Benzersiz kategori sayısı: ${uyeSayilari.size}`);

  // Başlık-sızdıran kategorilerin kaynakta elenmesinin etkisi (bkz.
  // hakemDilim.kategoriBasligiSizdiriyor yorumu).
  let sizdiranKategoriCifti = 0;
  let sizdiranEtkilenenSayfa = 0;
  for (const p of pages) {
    const n = p.categories.filter((c) => kategoriBasligiSizdiriyor(c, p.title)).length;
    sizdiranKategoriCifti += n;
    if (n > 0) sizdiranEtkilenenSayfa++;
  }
  console.log(
    `Başlığını içeren (sızdıran) kategoriler kaynakta elendi: ${sizdiranKategoriCifti} (sayfa,kategori) çifti, ${sizdiranEtkilenenSayfa} sayfa etkilendi\n`
  );

  const kurallar: KategoriKurali[] = ["uye6", "enBuyuk", "uye2"];
  const etiket: Record<KategoriKurali, string> = {
    uye6: "(a) üye ≥6, tohumlu karma",
    enBuyuk: "(b) en kalabalık kategori",
    uye2: "(c) üye ≥2, tohumlu karma",
  };

  const olcumler = kurallar.map((k) => olcKural(pages, uyeSayilari, k));

  console.log(
    `Kural                          "diğer"        pay     medyan(tüm)  medyan(diğer hariç)  p90   benzersiz değer`
  );
  for (const o of olcumler) {
    console.log(
      `${etiket[o.kural].padEnd(30)} ${String(o.digerSayisi).padStart(4)}/${pages.length}  %${(o.digerPayi * 100).toFixed(1).padStart(5)}  ${o.medyanTum.toFixed(1).padStart(10)}  ${o.medyanDigerHaric.toFixed(1).padStart(18)}  ${String(o.p90Tum).padStart(5)}  ${String(o.benzersizDegerSayisi).padStart(6)}`
    );
  }

  console.log(
    `\nÖlçüt: "diğer" ≤%${DIGER_UST_SINIR * 100} VE kategori-tek-başına medyan aday ${MEDYAN_ALT}–${MEDYAN_UST}\n`
  );

  const gecenler: KuralOlcumu[] = [];
  for (const o of olcumler) {
    const digerOk = o.digerPayi <= DIGER_UST_SINIR;
    const medyanOk = o.medyanTum >= MEDYAN_ALT && o.medyanTum <= MEDYAN_UST;
    console.log(
      `${etiket[o.kural].padEnd(30)} diğer=${digerOk ? "GEÇER" : "GEÇMEZ"}  medyan=${medyanOk ? "GEÇER" : "GEÇMEZ"}  => ${digerOk && medyanOk ? "✓ UYGUN" : "✗"}`
    );
    if (digerOk && medyanOk) gecenler.push(o);
  }

  if (gecenler.length === 0) {
    console.log(
      `\n*** DUR: hiçbir kural ölçütü sağlamıyor. Karar DeeOne'ındır. ***`
    );
    process.exitCode = 2;
    return;
  }

  // Birden fazla kural geçerse: medyanı hedef bandın ortasına (85) en
  // yakın olanı seç — ölçütün kendi mantığı dışında yeni kriter
  // uydurmamak için tek ve açık bir tie-break.
  const HEDEF_ORTA = (MEDYAN_ALT + MEDYAN_UST) / 2;
  gecenler.sort(
    (a, b) => Math.abs(a.medyanTum - HEDEF_ORTA) - Math.abs(b.medyanTum - HEDEF_ORTA)
  );
  console.log(
    `\nUYGUN KURAL(LAR): ${gecenler.map((g) => g.kural).join(", ")}`
  );
  console.log(
    `SEÇİM: ${gecenler[0].kural} (${etiket[gecenler[0].kural]}) — medyan ${gecenler[0].medyanTum.toFixed(1)}, hedef bandın ortasına (${HEDEF_ORTA}) en yakın`
  );
}

main();
