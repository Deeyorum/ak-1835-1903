import type { HakemKanali } from "../src/game/hakemKanali";
import type { MatchState, Role } from "../src/game/types";
import { distance, type WorldData } from "../src/game/world";
import {
  kategoriSlice,
  bolgeSlice,
  hareketSlice,
  harfSlice,
  dereceSlice,
  bandOf,
  type SliceType,
  type DereceEsikleri,
  type Band,
} from "./slices";

export { bandOf, type Band };

/**
 * G2B denge ölçümü için test hakemi stub'ı — yalnız test/ altında,
 * üretim koduna (src/game/hakemKanali.ts) GİRMEZ. G3'teki gerçek
 * hakemin vereceği bilginin taklidi: Avcı sorarsa Kaçak'a yönlü
 * mesafe BANDINI doğru söyler. Kaçak'tan gelen mesajlara üretim
 * stub'ıyla aynı sabit yanıtı verir (bu stub'ın amacı Avcı'yı
 * ölçmek, Kaçak'a bilgi sızdırmak değil).
 */
export function createBandHakemStub(
  world: WorldData,
  getState: () => MatchState
): HakemKanali {
  return {
    mesajGonder(gonderen: Role, _mesaj: string): string {
      if (gonderen !== "avci") return "Bu konuda bilgi veremem.";
      const state = getState();
      const d = distance(world, state.avciPosition, state.kacakPosition);
      if (d === undefined) return "bilinmiyor";
      return bandOf(d);
    },
  };
}

/**
 * TAM mesafe stub'ı — üst sınır ölçümü. Avcı sorarsa tam (yönlü) hop
 * mesafesini söyler. Gerçek G3 hakemi bu kadar kesin bilgi vermeyecek;
 * bu stub "mükemmel bilgiyle Avcı ne kadar iyi olabilir" tavanını ölçer.
 */
export function createExactHakemStub(
  world: WorldData,
  getState: () => MatchState
): HakemKanali {
  return {
    mesajGonder(gonderen: Role, _mesaj: string): string {
      if (gonderen !== "avci") return "Bu konuda bilgi veremem.";
      const state = getState();
      const d = distance(world, state.avciPosition, state.kacakPosition);
      return d === undefined ? "bilinmiyor" : String(d);
    },
  };
}

/**
 * G2C dilim stub'ı — SPEC §6'daki 5 dilim türünü taklit eden "panel"i
 * tek bir HakemKanali arayüzü üzerinden sunar (üretim arayüzü string
 * mesaj/string yanıt olduğu için, hangi dilimin sorulduğu mesaj
 * metnine kodlanır: mesaj tam olarak bir SliceType değeridir,
 * "kategori" | "bolge" | "hareket" | "harf" | "derece"). Her çağrı
 * yalnız o anki gerçek Kaçak sayfasının o dilimini döner — tam mesafe
 * veya tam konum ASLA içermez.
 */
export function createSliceHakemStub(
  world: WorldData,
  getState: () => MatchState,
  esikler: DereceEsikleri
): HakemKanali {
  return {
    mesajGonder(gonderen: Role, mesaj: string): string {
      if (gonderen !== "avci") return "Bu konuda bilgi veremem.";
      const state = getState();
      const sliceType = mesaj as SliceType;
      switch (sliceType) {
        case "kategori": {
          const page = world.pages.get(state.kacakPosition);
          const v = page ? kategoriSlice(page) : null;
          return v ?? "bilinmiyor";
        }
        case "bolge": {
          const v = bolgeSlice(world, state.avciPosition, state.kacakPosition);
          return v ?? "bilinmiyor";
        }
        case "hareket":
          return String(hareketSlice(state.kacakStayStreak));
        case "harf":
          return harfSlice(state.kacakPosition);
        case "derece":
          return dereceSlice(world, state.kacakPosition, esikler);
        default:
          return "bilinmiyor";
      }
    },
  };
}
