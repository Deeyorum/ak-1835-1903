import type { MatchState, Specialization, TurnLogEntry } from "../game/types";

export interface BotKaydi {
  id: string;
  name: string;
  owner: string | null;
  apiKeyHash: string;
  examPassed: boolean;
}

export interface MacSatiri {
  id: string;
  seed: number;
  turnLimit: number;
  kacakBotId: string | null;
  avciBotId: string | null;
  kacakSpecializations: Specialization[];
  avciSpecializations: Specialization[];
  status: MatchState["status"];
  state: MatchState;
}

function satirdanBot(row: Record<string, unknown>): BotKaydi {
  return {
    id: String(row.id),
    name: String(row.name),
    owner: row.owner === null ? null : String(row.owner),
    apiKeyHash: String(row.api_key_hash),
    examPassed: Number(row.exam_passed) === 1,
  };
}

function satirdanMac(row: Record<string, unknown>): MacSatiri {
  return {
    id: String(row.id),
    seed: Number(row.seed),
    turnLimit: Number(row.turn_limit),
    kacakBotId: row.kacak_bot_id === null ? null : String(row.kacak_bot_id),
    avciBotId: row.avci_bot_id === null ? null : String(row.avci_bot_id),
    kacakSpecializations: JSON.parse(String(row.kacak_specializations)),
    avciSpecializations: JSON.parse(String(row.avci_specializations)),
    status: String(row.status) as MatchState["status"],
    state: JSON.parse(String(row.state_json)),
  };
}

export async function botOlustur(
  db: D1Database,
  id: string,
  name: string,
  owner: string | null,
  apiKeyHash: string
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO bots (id, name, owner, api_key_hash, exam_passed) VALUES (?, ?, ?, ?, 0)"
    )
    .bind(id, name, owner, apiKeyHash)
    .run();
}

export async function botKarmayaGoreBul(
  db: D1Database,
  apiKeyHash: string
): Promise<BotKaydi | undefined> {
  const row = await db
    .prepare("SELECT * FROM bots WHERE api_key_hash = ?")
    .bind(apiKeyHash)
    .first();
  return row === null ? undefined : satirdanBot(row as Record<string, unknown>);
}

export async function botSinaviGecir(db: D1Database, botId: string): Promise<void> {
  await db.prepare("UPDATE bots SET exam_passed = 1 WHERE id = ?").bind(botId).run();
}

export interface YeniMacGirdisi {
  id: string;
  seed: number;
  turnLimit: number;
  kacakBotId: string | null;
  avciBotId: string | null;
  kacakSpecializations: Specialization[];
  avciSpecializations: Specialization[];
  state: MatchState;
}

export async function macOlustur(db: D1Database, girdi: YeniMacGirdisi): Promise<void> {
  await db
    .prepare(
      `INSERT INTO matches
        (id, seed, turn_limit, kacak_bot_id, avci_bot_id, kacak_specializations, avci_specializations, status, state_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      girdi.id,
      girdi.seed,
      girdi.turnLimit,
      girdi.kacakBotId,
      girdi.avciBotId,
      JSON.stringify(girdi.kacakSpecializations),
      JSON.stringify(girdi.avciSpecializations),
      girdi.state.status,
      JSON.stringify(girdi.state)
    )
    .run();
}

export async function macBul(db: D1Database, macId: string): Promise<MacSatiri | undefined> {
  const row = await db.prepare("SELECT * FROM matches WHERE id = ?").bind(macId).first();
  return row === null ? undefined : satirdanMac(row as Record<string, unknown>);
}

/**
 * Bir turu işler ve TEK SEFERDE yazar: `matches` güncel durumunu alır,
 * `turns` o turun günlüğünü ekler. Alt-adım başına (kaçak hamlesi, avcı
 * hamlesi, hakem mesajı) AYRI yazma YOK — D1 Free'nin 100K yazma/gün
 * bütçesini korumak için (bkz. db/schema-api.sql üst notu).
 */
export async function macTuruKaydet(
  db: D1Database,
  macId: string,
  yeniState: MatchState,
  logEntry: TurnLogEntry
): Promise<void> {
  await db.batch([
    db
      .prepare("UPDATE matches SET state_json = ?, status = ?, finished_at = ? WHERE id = ?")
      .bind(
        JSON.stringify(yeniState),
        yeniState.status,
        yeniState.status === "devam" ? null : new Date().toISOString(),
        macId
      ),
    db
      .prepare("INSERT INTO turns (match_id, turn, log_entry_json) VALUES (?, ?, ?)")
      .bind(macId, logEntry.turn, JSON.stringify(logEntry)),
  ]);
}

export async function macTurlariniGetir(
  db: D1Database,
  macId: string
): Promise<TurnLogEntry[]> {
  const { results } = await db
    .prepare("SELECT log_entry_json FROM turns WHERE match_id = ? ORDER BY turn ASC")
    .bind(macId)
    .all();
  return (results as { log_entry_json: string }[]).map((r) => JSON.parse(r.log_entry_json));
}
