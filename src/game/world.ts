import type { PageTitle, WorldPage } from "./types";

export interface WorldData {
  pages: Map<PageTitle, WorldPage>;
  adjacency: Map<PageTitle, PageTitle[]>;
  /**
   * Directed shortest-path hop distance, source -> target, LAZILY
   * POPULATED (G4A, bkz. DEFTER.md "G4A" sınır ölçümü). Başlangıçta
   * boştur; `distance()`/`neighborsWithin()` ilk erişimde kaynak
   * başına bir BFS çalıştırıp sonucu burada önbelleğe alır. Dışarıdan
   * yalnız bu iki fonksiyon üzerinden okunur (doğrudan erişim yok,
   * grep ile doğrulandı) — bu yüzden tembelleştirme davranışı hiçbir
   * çağırana görünmez, yalnız CPU maliyetinin ZAMANINI değiştirir,
   * SONUCUNU değiştirmez.
   */
  distances: Map<PageTitle, Map<PageTitle, number>>;
  /**
   * Ters bağlantı listesi (kim BURAYA bağlanıyor). `distancesTo()`'nun
   * tek-BFS-ile-tüm-kaynaklar optimizasyonu için gerekli; `adjacency`
   * kadar ucuz, dünya yüklenirken bir kez kurulur.
   */
  reverseAdjacency: Map<PageTitle, PageTitle[]>;
  /**
   * `distancesTo()` için tembel önbellek: hedef -> (kaynak -> mesafe).
   * Yalnız `distancesTo()` içeriden okur/yazar.
   */
  reverseDistances: Map<PageTitle, Map<PageTitle, number>>;
  /** Global word frequency across all page texts, for Dilbilimci distinctiveness scoring. */
  wordGlobalFreq: Map<string, number>;
  titles: PageTitle[];
}

function bfsDistances(
  source: PageTitle,
  adj: Map<PageTitle, PageTitle[]>
): Map<PageTitle, number> {
  const dist = new Map<PageTitle, number>([[source, 0]]);
  const q: PageTitle[] = [source];
  let qi = 0;
  while (qi < q.length) {
    const u = q[qi++];
    const d = dist.get(u);
    if (d === undefined) continue;
    for (const v of adj.get(u) ?? []) {
      if (!dist.has(v)) {
        dist.set(v, d + 1);
        q.push(v);
      }
    }
  }
  return dist;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-zçğıöşü]{3,}/g) ?? []);
}

/**
 * Dünya verisini (zaten alt kümeye süzülmüş bağlantılarla, örn.
 * world.scc.json'dan okunmuş sayfa listesi) kurar.
 *
 * TÜM-ÇİFTLER mesafe ön-hesabı YAPILMAZ (G4A öncesi davranış buydu —
 * bkz. DEFTER.md "G4A" sınır ölçümü: 1295 sayfalık dünyada bu adım
 * ~815ms CPU tüketiyordu, Workers'ın 10ms/istek bütçesinin veya
 * makul bir soğuk-başlangıç bütçesinin çok üzerinde). Mesafeler artık
 * `distance()`/`neighborsWithin()`/`distancesTo()` tarafından
 * KAYNAK BAŞINA, İLK ERİŞİMDE, tembelce hesaplanıp önbelleğe alınır
 * (tek kaynaklı BFS ~0.5ms). Bu, SAF bir performans değişikliğidir:
 * hiçbir dışa dönük fonksiyonun girdi→çıktı eşlemesi değişmedi, yalnız
 * hesaplamanın ZAMANI (eager→lazy) değişti. Mevcut tüm testler
 * (G1-G3) bu değişiklikten sonra da birebir aynı sonuçları üretir.
 *
 * KASITLI OLARAK dosya sistemine dokunmaz (fs YOK) — Cloudflare Workers
 * ortamında fs mevcut değildir. Dosyadan okuma sorumluluğu çağırana aittir
 * (yerel test için bkz. test/loadWorldFile.ts; G4'te D1'den okunacaktır).
 */
export function buildWorldData(rawPages: WorldPage[]): WorldData {
  const pages = new Map<PageTitle, WorldPage>();
  const adjacency = new Map<PageTitle, PageTitle[]>();
  const reverseAdjacency = new Map<PageTitle, PageTitle[]>();
  for (const p of rawPages) {
    pages.set(p.title, p);
    adjacency.set(p.title, p.links);
    if (!reverseAdjacency.has(p.title)) reverseAdjacency.set(p.title, []);
  }
  for (const p of rawPages) {
    for (const target of p.links) {
      if (!reverseAdjacency.has(target)) reverseAdjacency.set(target, []);
      reverseAdjacency.get(target)!.push(p.title);
    }
  }
  const titles = Array.from(pages.keys());

  const wordGlobalFreq = new Map<string, number>();
  for (const p of rawPages) {
    for (const word of tokenize(p.text)) {
      wordGlobalFreq.set(word, (wordGlobalFreq.get(word) ?? 0) + 1);
    }
  }

  return {
    pages,
    adjacency,
    reverseAdjacency,
    distances: new Map(),
    reverseDistances: new Map(),
    wordGlobalFreq,
    titles,
  };
}

/** `world.distances`'ta kaynak için BFS sonucu yoksa hesaplayıp önbelleğe alır. */
function forwardDistancesFrom(world: WorldData, source: PageTitle): Map<PageTitle, number> {
  const mevcut = world.distances.get(source);
  if (mevcut !== undefined) return mevcut;
  const hesaplanan = bfsDistances(source, world.adjacency);
  world.distances.set(source, hesaplanan);
  return hesaplanan;
}

/** Directed shortest-path distance from -> to, or undefined if unreachable. */
export function distance(
  world: WorldData,
  from: PageTitle,
  to: PageTitle
): number | undefined {
  if (from === to) return 0;
  return forwardDistancesFrom(world, from).get(to);
}

/**
 * Yönlü mesafe X -> target, TÜM X için tek seferde (ters BFS,
 * `target`'a göre önbelleklenir). "Birçok kaynak, tek hedef" erişim
 * deseni için (örn. Avcı başlangıç adayları: Kaçak'tan ≥N hop uzaktaki
 * TÜM sayfalar) — bu deseni `distance()`'ı döngüde çağırarak çözmek
 * O(V·(V+E)) olurdu; burada O(V+E)'dir (bkz. DEFTER.md "G4A").
 */
export function distancesTo(world: WorldData, target: PageTitle): Map<PageTitle, number> {
  const mevcut = world.reverseDistances.get(target);
  if (mevcut !== undefined) return mevcut;
  const hesaplanan = bfsDistances(target, world.reverseAdjacency);
  world.reverseDistances.set(target, hesaplanan);
  return hesaplanan;
}

/** Out-degree (link count) of a page within the loaded subset. */
export function outDegree(world: WorldData, title: PageTitle): number {
  return world.adjacency.get(title)?.length ?? 0;
}

/** Count of distinct pages reachable within `hops` directed steps (excludes the source itself). */
export function neighborsWithin(
  world: WorldData,
  title: PageTitle,
  hops: number
): number {
  const dist = forwardDistancesFrom(world, title);
  let count = 0;
  for (const [other, d] of dist) {
    if (other !== title && d <= hops) count++;
  }
  return count;
}
