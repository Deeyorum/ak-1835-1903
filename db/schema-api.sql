-- AK-1835-1903 — G4A API şeması (bots, matches, turns)
--
-- db/schema.sql (G1) dünya verisi içindir (pages/links/categories, henüz
-- D1'e yüklenmedi — bkz. ACIK_ISLER.md). Bu dosya AYRI ve bağımsızdır:
-- API'nin kendi durumu (bot kaydı, maç durumu, tur kayıtları).
--
-- Yazma sayısı kasıtlı en aza indirildi (D1 Free: 100K yazma/gün):
-- bir tur = bir `matches` UPDATE + bir `turns` INSERT (alt-adım başına
-- ayrı yazma YOK — kaçak hamlesi, avcı hamlesi, hakem mesajları tek bir
-- processTurn() çağrısında toplanıp tek seferde yazılır).

CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner TEXT,
  -- Yalnız karma saklanır (SHA-256, hex) — gerçek anahtar hiçbir yerde
  -- tutulmaz, yalnız üretildiği anda bota tek seferlik döndürülür.
  api_key_hash TEXT NOT NULL UNIQUE,
  exam_passed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  seed INTEGER NOT NULL,
  turn_limit INTEGER NOT NULL,
  -- Rolü gerçek bot oynuyorsa bots.id; platform botu oynuyorsa NULL.
  kacak_bot_id TEXT REFERENCES bots(id),
  avci_bot_id TEXT REFERENCES bots(id),
  kacak_specializations TEXT NOT NULL, -- JSON dizi
  avci_specializations TEXT NOT NULL,  -- JSON dizi
  -- Panel ataması tohumludur (hakemPaneliKur(seed,3)); burada SAKLANMAZ,
  -- seed'den her seferinde yeniden türetilir (G3 ile tutarlı, tekrar
  -- yazma gerektirmez).
  status TEXT NOT NULL DEFAULT 'devam', -- devam | avciKazandi | kacakKazandi
  -- Güncel MatchState (JSON) — bir sonraki turu işlemek için yeniden
  -- okunur. TurnLogEntry geçmişi BURADA değil, `turns` tablosunda tutulur
  -- (bu sütun yalnız en güncel durumun anlık görüntüsüdür).
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL REFERENCES matches(id),
  turn INTEGER NOT NULL,
  -- TurnLogEntry'nin JSON serileştirmesi (kacakMove, avciMove,
  -- hakemMesajlari, yakalamaSonucu, rejected, suzgecOlaylari).
  log_entry_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (match_id, turn)
);

CREATE INDEX idx_bots_api_key_hash ON bots(api_key_hash);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_matches_kacak_bot ON matches(kacak_bot_id);
CREATE INDEX idx_matches_avci_bot ON matches(avci_bot_id);
CREATE INDEX idx_turns_match ON turns(match_id);
