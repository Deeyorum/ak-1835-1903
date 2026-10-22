import type {
  AvciMove,
  HakemMesaji,
  HakemYanitKaydi,
  KacakMove,
  MatchState,
  TurnLogEntry,
  TurnResult,
} from "./types";
import type { WorldData } from "./world";
import { kullanUzmanlikArac } from "./tools";
import type { HakemKanali } from "./hakemKanali";
import { sariliMetniAyristir } from "./hakemKanali";
import type { OlayToplayici } from "./hakemSuzgec";

/** Tur başına temel hakem mesaj/soru kotası; Arabulucu +1 ekler. */
const BASE_HAKEM_KOTASI = 1;

function hakemKotasi(state: MatchState, role: "kacak" | "avci"): number {
  const specs = role === "kacak" ? state.kacakSpecializations : state.avciSpecializations;
  return BASE_HAKEM_KOTASI + (specs.includes("arabulucu") ? 1 : 0);
}

function isDirectLink(world: WorldData, from: string, to: string): boolean {
  return (world.adjacency.get(from) ?? []).includes(to);
}

/**
 * Ek hakem mesajı. Düz string verilirse mesaj `avciHakemId`/
 * `kacakHakemId`'ye (o da yoksa sistem hakemine) gider; nesne biçimi
 * mesaj başına ayrı hakem adreslemeye izin verir (K≥2'de Avcı farklı
 * hakemlere sorabilmelidir).
 */
export type EkHakemMesaji = string | { mesaj: string; hakemId?: string };

export interface ProcessTurnOptions {
  /** sorHakeme dışında, kotaya dahil ek hakem mesajları. */
  kacakHakemMesajlari?: readonly EkHakemMesaji[];
  avciHakemMesajlari?: readonly EkHakemMesaji[];
  /** Ek mesajların gideceği varsayılan hakem (verilmezse sistem hakemi). */
  avciHakemId?: string;
  kacakHakemId?: string;
  /** Çıkış süzgeci olaylarını maç kaydına taşıyan biriktirici (G3). */
  olayToplayici?: OlayToplayici;
}

function cozEkMesaj(
  m: EkHakemMesaji,
  varsayilanHakemId: string | undefined
): { mesaj: string; hakemId: string | undefined } {
  if (typeof m === "string") return { mesaj: m, hakemId: varsayilanHakemId };
  return { mesaj: m.mesaj, hakemId: m.hakemId ?? varsayilanHakemId };
}

/**
 * Bir turu işler: Kaçak hamlesi -> Avcı hamlesi -> hakem penceresi -> durum
 * güncellemesi. Geçersiz hamle reddedilir, o aktörün durumu değişmez
 * (diğer aktörün hamlesi bundan etkilenmez).
 */
export function processTurn(
  world: WorldData,
  state: MatchState,
  kacakMove: KacakMove,
  avciMove: AvciMove,
  hakemKanali: HakemKanali,
  options: ProcessTurnOptions = {}
): TurnResult {
  if (state.status !== "devam") {
    throw new Error(`Bitmiş maçta tur işlenemez (status=${state.status})`);
  }

  const rejected: TurnLogEntry["rejected"] = [];
  const toolSonuclari: TurnLogEntry["toolSonuclari"] = [];
  let kacakPosition = state.kacakPosition;
  let kacakStayStreak = state.kacakStayStreak;
  let kacakMoveCount = state.kacakMoveCount;
  let kacakStayCount = state.kacakStayCount;

  // 1) Kaçak hamlesi
  if (kacakMove.type === "kal") {
    kacakStayStreak += 1;
    kacakStayCount += 1;
  } else if (kacakMove.type === "git") {
    if (isDirectLink(world, kacakPosition, kacakMove.to)) {
      kacakPosition = kacakMove.to;
      kacakMoveCount += 1;
      kacakStayStreak = 0;
    } else {
      rejected.push({ role: "kacak", reason: `Geçersiz bağlantı: ${kacakMove.to}` });
    }
  } else if (kacakMove.type === "uzmanlikAraci") {
    const result = kullanUzmanlikArac(world, state, "kacak", kacakMove.arac, {
      hedefSayfa: kacakPosition,
    });
    if (!result.ok) {
      rejected.push({ role: "kacak", reason: result.reason });
    } else {
      toolSonuclari.push({ role: "kacak", arac: result.arac, sonuc: result.sonuc });
    }
  }

  // 2) Avcı hamlesi (Kaçak'ın bu turdaki yeni konumuna göre değerlendirilir)
  let avciPosition = state.avciPosition;
  let yakalamaSonucu: TurnLogEntry["yakalamaSonucu"];
  const hakemMesajlari: HakemMesaji[] = [];
  let avciHakemKullanimi = 0;

  if (avciMove.type === "git") {
    if (isDirectLink(world, avciPosition, avciMove.to)) {
      avciPosition = avciMove.to;
    } else {
      rejected.push({ role: "avci", reason: `Geçersiz bağlantı: ${avciMove.to}` });
    }
  } else if (avciMove.type === "yakala") {
    if (avciPosition === kacakPosition) {
      yakalamaSonucu = "basarili";
    } else {
      yakalamaSonucu = "basarisiz";
    }
  } else if (avciMove.type === "uzmanlikAraci") {
    const result = kullanUzmanlikArac(world, state, "avci", avciMove.arac, avciMove.params as any);
    if (!result.ok) {
      rejected.push({ role: "avci", reason: result.reason });
    } else {
      toolSonuclari.push({ role: "avci", arac: result.arac, sonuc: result.sonuc });
    }
  } else if (avciMove.type === "sorHakeme") {
    const yanit = hakemKanali.mesajGonder("avci", avciMove.mesaj, avciMove.hakemId);
    hakemMesajlari.push({
      gonderen: "avci",
      mesaj: avciMove.mesaj,
      yanit,
      hakemId: avciMove.hakemId,
    });
    avciHakemKullanimi += 1;
  }

  // 3) Hakem penceresi — ek mesajlar (kota dahilinde)
  const kacakKota = hakemKotasi(state, "kacak");
  for (const ham of options.kacakHakemMesajlari ?? []) {
    if (hakemMesajlari.filter((m) => m.gonderen === "kacak").length >= kacakKota) {
      rejected.push({ role: "kacak", reason: "Hakem mesaj kotası doldu" });
      break;
    }
    const { mesaj, hakemId } = cozEkMesaj(ham, options.kacakHakemId);
    const yanit = hakemKanali.mesajGonder("kacak", mesaj, hakemId);
    hakemMesajlari.push({ gonderen: "kacak", mesaj, yanit, hakemId });
  }

  const avciKota = hakemKotasi(state, "avci");
  for (const ham of options.avciHakemMesajlari ?? []) {
    if (avciHakemKullanimi >= avciKota) {
      rejected.push({ role: "avci", reason: "Hakem mesaj kotası doldu" });
      break;
    }
    const { mesaj, hakemId } = cozEkMesaj(ham, options.avciHakemId);
    const yanit = hakemKanali.mesajGonder("avci", mesaj, hakemId);
    hakemMesajlari.push({ gonderen: "avci", mesaj, yanit, hakemId });
    avciHakemKullanimi += 1;
  }

  // 3b) Çıkış süzgeci olayları — kanal tarafından yazıldı, kayda alınır.
  const suzgecOlaylari = options.olayToplayici?.bosalt() ?? [];

  /**
   * Avcı'nın hakem yanıtları maç boyunca BİRİKİR (G3 Madde 3; G2D'nin
   * "tamlık" bulgusu: bilgiyi atmak, hedef hareketsizken bile başlı
   * başına bir cezaydı). Yanıt bu turun numarasıyla kaydedilir ve
   * avciView tarafından yalnız SONRAKİ turlarda gösterilir.
   */
  const yeniYanitlar: HakemYanitKaydi[] = hakemMesajlari
    .filter((m) => m.gonderen === "avci")
    .map((m) => {
      // C ("Untrusted text contract"): `m.yanit` kanaldan SARILI gelir
      // (bkz. hakemKanali.ts `etiketleSar`). Etiket/kesilme işareti bu
      // sarmalayıcıdan AYIKLANIR — tekrar hesaplanmaz (tek doğruluk
      // kaynağı sarılı dizgenin kendisidir).
      const { etiket, kesildiMi } = sariliMetniAyristir(m.yanit);
      return {
        turn: state.turn,
        hakemId: m.hakemId ?? "sistem",
        soru: m.mesaj,
        yanit: m.yanit,
        etiket,
        kesildi: kesildiMi,
        // Madde 2 (G4B-1b): `state.avciPosition` — bu ÇAĞRININ geldiği
        // (yani `hakemKanali`'nin `getState()` ile okuduğu) konum, bu
        // turdaki olası Avcı hareketinden (yukarıdaki yerel `avciPosition`
        // DEĞİL) bağımsız. `dilimUret()`'in `bolge` için kullandığı KONUM
        // TAM OLARAK budur (bkz. types.ts HakemYanitKaydi.avciKonum notu).
        avciKonum: state.avciPosition,
      };
    });

  // 4) Durum güncelle
  let status: MatchState["status"] = state.status;
  if (yakalamaSonucu === "basarili") {
    status = "avciKazandi";
  } else if (state.turn >= state.turnLimit) {
    status = "kacakKazandi";
  }

  const logEntry: TurnLogEntry = {
    turn: state.turn,
    kacakMove,
    avciMove,
    hakemMesajlari,
    yakalamaSonucu,
    rejected: rejected.length > 0 ? rejected : undefined,
    suzgecOlaylari: suzgecOlaylari.length > 0 ? suzgecOlaylari : undefined,
    toolSonuclari: toolSonuclari.length > 0 ? toolSonuclari : undefined,
  };

  const newState: MatchState = {
    ...state,
    kacakPosition,
    avciPosition,
    kacakStayStreak,
    kacakMoveCount,
    kacakStayCount,
    turn: state.turn + 1,
    status,
    log: [...state.log, logEntry],
    avciHakemYanitlari: [...(state.avciHakemYanitlari ?? []), ...yeniYanitlar],
  };

  return { state: newState, logEntry };
}
