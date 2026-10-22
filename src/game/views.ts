import type {
  HakemYanitKaydi,
  MatchState,
  PageTitle,
  Specialization,
} from "./types";
import type { WorldData } from "./world";

export interface KacakView {
  kendiKonum: PageTitle;
  komsular: PageTitle[];
  kendiUzmanliklari: Specialization[];
  rakipUzmanliklari: Specialization[];
  tur: number;
  turSiniri: number;
  durum: MatchState["status"];
}

export interface AvciView {
  kendiKonum: PageTitle;
  komsular: PageTitle[];
  kendiUzmanliklari: Specialization[];
  rakipUzmanliklari: Specialization[];
  tur: number;
  turSiniri: number;
  durum: MatchState["status"];
  /**
   * Maç boyunca BİRİKEN hakem yanıtları (G3 Madde 3). Yalnız geçmiş
   * turlarda sorulmuş sorular görünür: bu turun sorusunun yanıtı bir
   * SONRAKİ turda listeye girer (SPEC §7 tur sırası — hakem penceresi
   * Avcı hamlesinden sonra işlenir, yani yanıt o hamleye yetişemez).
   */
  hakemYanitlari: readonly HakemYanitKaydi[];
}

/**
 * Kaçak görünümü. KASITLI OLARAK state.avciPosition'ı okumaz — bu
 * fonksiyonun Avcı'nın konumuna dair hiçbir bilgi üretmediği
 * test/leak.test.ts'de doğrulanır (iki durumun yalnız avciPosition'ı
 * farklıyken aynı görünümü üretmesi beklenir).
 */
export function kacakView(world: WorldData, state: MatchState): KacakView {
  return {
    kendiKonum: state.kacakPosition,
    komsular: world.adjacency.get(state.kacakPosition) ?? [],
    kendiUzmanliklari: state.kacakSpecializations,
    rakipUzmanliklari: state.avciSpecializations,
    tur: state.turn,
    turSiniri: state.turnLimit,
    durum: state.status,
  };
}

/**
 * Avcı görünümü. KASITLI OLARAK state.kacakPosition'ı okumaz — bkz.
 * kacakView üstündeki not, aynı sızıntı testi simetrik olarak uygulanır.
 */
export function avciView(world: WorldData, state: MatchState): AvciView {
  return {
    kendiKonum: state.avciPosition,
    komsular: world.adjacency.get(state.avciPosition) ?? [],
    kendiUzmanliklari: state.avciSpecializations,
    rakipUzmanliklari: state.kacakSpecializations,
    tur: state.turn,
    turSiniri: state.turnLimit,
    durum: state.status,
    hakemYanitlari: (state.avciHakemYanitlari ?? []).filter((y) => y.turn < state.turn),
  };
}
