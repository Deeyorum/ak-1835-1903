import type { MatchState, PageTitle, Role, Specialization } from "./types";
import { distance, neighborsWithin, outDegree, tokenize, type WorldData } from "./world";

export type ToolResult =
  | { ok: true; arac: Specialization; sonuc: unknown }
  | { ok: false; reason: string };

function declaredSpecs(state: MatchState, role: Role): Specialization[] {
  return role === "kacak" ? state.kacakSpecializations : state.avciSpecializations;
}

function ownPosition(state: MatchState, role: Role): PageTitle {
  return role === "kacak" ? state.kacakPosition : state.avciPosition;
}

/** Haritacı — Avcı: verilen sayfanın 2 hop içindeki komşu sayısı. */
export function haritaciAvci(world: WorldData, hedefSayfa: PageTitle): number {
  return neighborsWithin(world, hedefSayfa, 2);
}

/** Haritacı — Kaçak: bulunduğu sayfanın bağlantı derecesi. */
export function haritaciKacak(world: WorldData, kendiSayfa: PageTitle): number {
  return outDegree(world, kendiSayfa);
}

/** Dilbilimci — Avcı: verilen hakem yanıtı metinlerindeki sözcük sıklığı. */
export function dilbilimciAvci(hakemYanitlari: string[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const text of hakemYanitlari) {
    for (const word of tokenize(text)) {
      freq[word] = (freq[word] ?? 0) + 1;
    }
  }
  return freq;
}

/**
 * Dilbilimci — Kaçak: kendi sayfasının metninden en ayırt edici 5 sözcük.
 * Ayırt edicilik = sayfa içi sıklık / küresel (dünya çapında) sıklık —
 * yalnız bu sayfada sık geçen ama genelde nadir olan sözcükler öne çıkar.
 */
export function dilbilimciKacak(world: WorldData, kendiSayfa: PageTitle): string[] {
  const page = world.pages.get(kendiSayfa);
  if (!page) return [];
  const localFreq = new Map<string, number>();
  for (const word of tokenize(page.text)) {
    localFreq.set(word, (localFreq.get(word) ?? 0) + 1);
  }
  const scored = Array.from(localFreq.entries()).map(([word, local]) => {
    const global = world.wordGlobalFreq.get(word) ?? local;
    return { word, score: local / global };
  });
  scored.sort((a, b) => b.score - a.score || a.word.localeCompare(b.word));
  return scored.slice(0, 5).map((s) => s.word);
}

/** Profilci — Avcı: rakibin (Kaçak) beyan ettiği uzmanlıklar + hareket/kalma oranı. */
export function profilciAvci(state: MatchState): {
  rakipUzmanliklari: Specialization[];
  hareketKalmaOrani: number;
} {
  const totalTurns = state.kacakMoveCount + state.kacakStayCount;
  const oran = totalTurns === 0 ? 0 : state.kacakMoveCount / totalTurns;
  return {
    rakipUzmanliklari: state.kacakSpecializations,
    hareketKalmaOrani: oran,
  };
}

/** Profilci — Kaçak: rakibin (Avcı) beyan ettiği uzmanlıklar. */
export function profilciKacak(state: MatchState): { rakipUzmanliklari: Specialization[] } {
  return { rakipUzmanliklari: state.avciSpecializations };
}

/**
 * Bir uzmanlık aracını çağırır. Beyan edilmemiş uzmanlığın aracı çağrılırsa
 * hata döner (SPEC §5: "API 403 döner" — G2 saf motorunda bu, HTTP katmanı
 * olmadığı için ok:false sonuç olarak modellenir; G4'teki API katmanı bunu
 * 403'e çevirecek).
 */
export function kullanUzmanlikArac(
  world: WorldData,
  state: MatchState,
  role: Role,
  arac: Specialization,
  params: { hedefSayfa?: PageTitle; hakemYanitlari?: string[] } = {}
): ToolResult {
  if (!declaredSpecs(state, role).includes(arac)) {
    return { ok: false, reason: `Beyan edilmemiş uzmanlık: ${arac}` };
  }

  switch (arac) {
    case "haritaci": {
      const hedef = role === "avci" ? params.hedefSayfa : ownPosition(state, role);
      if (!hedef) return { ok: false, reason: "hedefSayfa gerekli" };
      const sonuc =
        role === "avci" ? haritaciAvci(world, hedef) : haritaciKacak(world, hedef);
      return { ok: true, arac, sonuc };
    }
    case "dilbilimci": {
      if (role === "avci") {
        return {
          ok: true,
          arac,
          sonuc: dilbilimciAvci(params.hakemYanitlari ?? []),
        };
      }
      return { ok: true, arac, sonuc: dilbilimciKacak(world, ownPosition(state, role)) };
    }
    case "profilci": {
      const sonuc = role === "avci" ? profilciAvci(state) : profilciKacak(state);
      return { ok: true, arac, sonuc };
    }
    case "arabulucu": {
      // Arabulucu kendi başına bir sorgu aracı değil — tur başına +1
      // hakem mesaj/soru hakkı sağlar (bkz. engine.ts hakemKotasi).
      return { ok: false, reason: "Arabulucu bağımsız bir sorgu aracı değildir, hakem mesaj kotasını artırır." };
    }
    default:
      return { ok: false, reason: `Bilinmeyen araç: ${arac}` };
  }
}
