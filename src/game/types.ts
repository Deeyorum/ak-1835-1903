export type PageTitle = string;

export type Role = "kacak" | "avci";

export type Specialization =
  | "haritaci"
  | "dilbilimci"
  | "profilci"
  | "arabulucu";

export const ALL_SPECIALIZATIONS: Specialization[] = [
  "haritaci",
  "dilbilimci",
  "profilci",
  "arabulucu",
];

export const MAX_SPECIALIZATIONS = 2;

export interface WorldPage {
  title: PageTitle;
  text: string;
  categories: string[];
  links: PageTitle[];
  /** world.scc.json'da mevcut; çıkış süzgecinin engellediği "sayfa
   * kimliği" budur (G3). Eski üretilmiş dünyalarda olmayabilir. */
  pageId?: number;
  url?: string;
  revisionId?: number;
}

// NOT (SPEC çelişkisi, bkz. DEFTER.md "G2: oyun motoru"): SPEC §4 Kaçak'ın
// turunu yalnız git/kal olarak listeler, ama §5 tablosu Kaçak-tarafı
// uzmanlık araçları tanımlar (Haritacı/Dilbilimci/Profilci). §4'ün listesi
// eksik sayılıp Kaçak'a da Avcı ile simetrik bir "uzmanlikAraci" seçeneği
// eklendi — aksi halde §5'in Kaçak sütunu hiç kullanılamazdı.
export type KacakMove =
  | { type: "git"; to: PageTitle }
  | { type: "kal" }
  | { type: "uzmanlikAraci"; arac: Specialization; params?: unknown };

export type AvciMove =
  | { type: "git"; to: PageTitle }
  /** hakemId verilmezse mesaj sistem hakemine gider (G3). */
  | { type: "sorHakeme"; mesaj: string; hakemId?: string }
  | { type: "uzmanlikAraci"; arac: Specialization; params?: unknown }
  | { type: "yakala" };

export interface HakemMesaji {
  gonderen: Role;
  mesaj: string;
  yanit: string;
  /** Yanıtı veren hakem (G3 panel öncesi kayıtlarda yoktur). */
  hakemId?: string;
}

/**
 * Çıkış süzgecinin engellediği bir yanıt — maç kaydına yazılır (SPEC §9,
 * G3 Madde 4). `engellenenMetin` KASITLI olarak saklanmaz: olay kaydı
 * maç kaydına girer ve maç kaydı 30 gün sonra yayımlanır (SPEC §9), ham
 * sızıntı metni orada durursa süzgeç anlamsızlaşır.
 */
export interface SuzgecOlayi {
  turn: number;
  hakemId: string;
  /** Hangi yasak değer yakalandı: "baslik" | "sayfaKimligi" | "digerDilim" */
  sebep: "baslik" | "sayfaKimligi" | "digerDilim";
  /** Hangi varyant yakaladı: "duz" | "ters" | "kodlama" */
  varyant: "duz" | "ters" | "kodlama";
}

/** Avcı'nın maç boyunca biriktirdiği hakem yanıtı (G3 Madde 3). */
export interface HakemYanitKaydi {
  /** Sorunun sorulduğu tur. Yanıt bir SONRAKİ turda görünür hale gelir. */
  turn: number;
  hakemId: string;
  soru: string;
  yanit: string;
  /**
   * Madde 2 (G4B-1b): dilimin ÜRETİLDİĞİ anki Avcı konumu — yani
   * `hakemKanali.mesajGonder()`'ın `getState()`'ten okuduğu konum (bu
   * turun BAŞINDAKİ konum, bu turda Avcı'nın kendi hamlesinden
   * ETKİLENMEZ, bkz. engine.ts'teki `state.avciPosition` notu).
   * `bolge` dilimi bu konuma GÖRE üretildiği için, bu değeri SONRADAN
   * (başka bir turda) yeniden süzmek için `view.kendiKonum` (GÜNCEL
   * konum) kullanmak YANLIŞTIR — Avcı o turdan sonra hareket etmiş
   * olabilir. Bu alan BU SORUNU çözer: süzme her zaman SORUNUN
   * SORULDUĞU ANDAKİ konumla yapılmalı. Eski/mock HakemYanitKaydi
   * nesneleri bu alanı içermeyebilir (yalnız ekleme — bkz. DEFTER.md
   * "G4B-1b"), okuyan taraf `undefined` durumunu AÇIKÇA ele almalı.
   */
  avciKonum?: PageTitle;
  /**
   * C ("Untrusted text contract"): `yanit` artık o turun rastgele
   * etiketiyle SARILI gelir (bkz. `src/game/hakemKanali.ts`
   * `etiketleSar`/`sariliMetniAyristir`) — bu alan o etiketin DÜZ
   * DEĞERİDİR (sarmalayıcı dizgelerden ayrı, "ayrı alanda da verilsin"
   * talimatı). Eski kayıtlarda (bu alan eklenmeden önce üretilmiş)
   * veya `HakemKanali`'nin test/stub implementasyonlarından gelen
   * sarılmamış yanıtlarda boş dizgedir (`""`) — okuyan taraf bunu
   * AÇIKÇA "etiket yok" olarak ele almalı.
   */
  etiket?: string;
  /** `yanit`in 500 Unicode karakter sınırını aştığı için kesildiği
   * işareti (C). Kesilmediyse `false`/`undefined` — ikisi de aynı anlama
   * gelir, okuyan taraf `=== true` ile kontrol etmeli. */
  kesildi?: boolean;
}

export interface MatchConfig {
  seed: number;
  kacakSpecializations: Specialization[];
  avciSpecializations: Specialization[];
  turnLimit?: number;
}

export type MatchStatus = "devam" | "avciKazandi" | "kacakKazandi";

export interface MatchState {
  seed: number;
  turn: number;
  turnLimit: number;
  kacakPosition: PageTitle;
  avciPosition: PageTitle;
  kacakSpecializations: Specialization[];
  avciSpecializations: Specialization[];
  kacakStayStreak: number;
  kacakMoveCount: number;
  kacakStayCount: number;
  status: MatchStatus;
  log: TurnLogEntry[];
  /** Avcı'nın biriktirdiği hakem yanıtları (G3). Eski çağrı yerleri
   * bu alanı vermeyebilir; okuyan taraf `?? []` ile korunur. */
  avciHakemYanitlari?: HakemYanitKaydi[];
}

export interface TurnLogEntry {
  turn: number;
  kacakMove: KacakMove;
  avciMove: AvciMove;
  hakemMesajlari: HakemMesaji[];
  yakalamaSonucu?: "basarili" | "basarisiz";
  rejected?: { role: Role; reason: string }[];
  /** Bu turda çıkış süzgecinin engellediği hakem yanıtları (G3). */
  suzgecOlaylari?: SuzgecOlayi[];
  /**
   * Bu turda BAŞARIYLA kullanılan uzmanlık araçlarının sonucu (G4A).
   *
   * NOT (G4A'da bulunan boşluk): `kullanUzmanlikArac()`'ın döndürdüğü
   * `ToolResult.sonuc`, `ok:false` olduğunda `rejected`e yazılıyordu
   * ama `ok:true` olduğunda HİÇBİR YERE yazılmıyordu — tool başarıyla
   * çağrılsa bile çağıran sonucu asla öğrenemiyordu (G2'den beri
   * mevcut bir boşluk, G4A'nın API'yi gerçekten kullanılabilir kılması
   * sırasında bulundu). Bu alan additiftir (optional); mevcut hiçbir
   * test/çağıran bu alanın yokluğuna bağlı değildi.
   */
  toolSonuclari?: { role: Role; arac: Specialization; sonuc: unknown }[];
}

export interface TurnResult {
  state: MatchState;
  logEntry: TurnLogEntry;
}
