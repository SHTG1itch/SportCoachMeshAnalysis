import Database from "better-sqlite3";
import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
import type {
  AnalysisRecord,
  AppSettings,
  SavedWorkout,
} from "../shared/types";

let db: Database.Database | null = null;

export function initDb(): Database.Database {
  if (db) return db;
  const dir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, "coach.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      sport_id TEXT NOT NULL,
      shot TEXT NOT NULL,
      thumbnail TEXT,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_analyses_created ON analyses(created_at DESC);

    CREATE TABLE IF NOT EXISTS workouts (
      id TEXT PRIMARY KEY,
      saved_at TEXT NOT NULL,
      analysis_id TEXT,
      tags TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workouts_saved ON workouts(saved_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // One-time migration: the app is fully offline now and no longer stores an
  // Anthropic API key or model choice. Remove any legacy rows from older DBs so
  // the settings shape matches the current AppSettings. (A plain DELETE is the
  // right tool here — secure freelist scrubbing was considered and deferred:
  // the key was always plaintext in SQLite by design, so it's out of scope, and
  // VACUUM can't run inside a transaction, which would risk startup.)
  db.prepare(`DELETE FROM settings WHERE key IN ('anthropicApiKey','model')`).run();
  return db;
}

function requireDb(): Database.Database {
  if (!db) throw new Error("DB not initialized");
  return db;
}

/** Checkpoint the WAL and close the connection on app shutdown. Truncating the
 * checkpoint flushes pending writes back into the main DB file so we don't leave
 * an ever-growing -wal alongside it. Safe to call when the DB was never opened. */
export function closeDb(): void {
  if (!db) return;
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // best-effort; closing below still flushes
  }
  db.close();
  db = null;
}

// ---- Analyses ----

export function saveAnalysis(r: AnalysisRecord): void {
  const d = requireDb();
  d.prepare(
    `INSERT OR REPLACE INTO analyses (id, created_at, sport_id, shot, thumbnail, payload)
     VALUES (@id, @createdAt, @sportId, @shot, @thumbnail, @payload)`,
  ).run({
    id: r.id,
    createdAt: r.createdAt,
    sportId: r.sportId,
    shot: r.shot,
    thumbnail: r.thumbnailDataUrl ?? null,
    payload: JSON.stringify(r.report),
  });
}

/** Upper bound on rows returned to the renderer in one list call. Each record
 * embeds a full AnalysisReport (DTW path + similarity timeline can be hundreds of
 * KB), and the store re-reads the list on every mutation, so an unbounded SELECT
 * would make a long-lived install slower and slower. 500 newest is far more than
 * any real user browses while keeping memory and parse cost bounded. */
const LIST_LIMIT = 500;

export function listAnalyses(): AnalysisRecord[] {
  const d = requireDb();
  const rows = d
    .prepare(
      `SELECT id, created_at as createdAt, sport_id as sportId, shot,
              thumbnail, payload FROM analyses ORDER BY created_at DESC
       LIMIT ${LIST_LIMIT}`,
    )
    .all() as {
    id: string;
    createdAt: string;
    sportId: string;
    shot: string;
    thumbnail: string | null;
    payload: string;
  }[];
  // Guard each row's JSON.parse individually: a single corrupt / schema-
  // incompatible payload (manual DB edit, a record from an incompatible version)
  // must NOT throw and take down the entire History / Home / library view. Skip
  // and warn instead, so the rest of the user's data still loads.
  const out: AnalysisRecord[] = [];
  for (const row of rows) {
    try {
      out.push({
        id: row.id,
        createdAt: row.createdAt,
        sportId: row.sportId as AnalysisRecord["sportId"],
        shot: row.shot,
        thumbnailDataUrl: row.thumbnail ?? undefined,
        report: JSON.parse(row.payload),
      });
    } catch (e) {
      console.warn(`Skipping unreadable analysis row ${row.id}:`, e);
    }
  }
  return out;
}

export function getAnalysis(id: string): AnalysisRecord | null {
  const d = requireDb();
  const row = d
    .prepare(
      `SELECT id, created_at as createdAt, sport_id as sportId, shot,
              thumbnail, payload FROM analyses WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        createdAt: string;
        sportId: string;
        shot: string;
        thumbnail: string | null;
        payload: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    sportId: row.sportId as AnalysisRecord["sportId"],
    shot: row.shot,
    thumbnailDataUrl: row.thumbnail ?? undefined,
    report: JSON.parse(row.payload),
  };
}

export function deleteAnalysis(id: string): void {
  requireDb().prepare(`DELETE FROM analyses WHERE id = ?`).run(id);
}

// ---- Workouts ----

export function saveWorkout(w: SavedWorkout): void {
  requireDb()
    .prepare(
      `INSERT OR REPLACE INTO workouts (id, saved_at, analysis_id, tags, payload)
       VALUES (@id, @savedAt, @analysisId, @tags, @payload)`,
    )
    .run({
      id: w.id,
      savedAt: w.savedAt,
      analysisId: w.analysisId ?? null,
      tags: JSON.stringify(w.tags),
      payload: JSON.stringify(w.workout),
    });
}

export function listWorkouts(): SavedWorkout[] {
  const rows = requireDb()
    .prepare(
      `SELECT id, saved_at as savedAt, analysis_id as analysisId,
              tags, payload FROM workouts ORDER BY saved_at DESC
       LIMIT ${LIST_LIMIT}`,
    )
    .all() as {
    id: string;
    savedAt: string;
    analysisId: string | null;
    tags: string;
    payload: string;
  }[];
  // Per-row guard (see listAnalyses): one corrupt workout row must not blank the
  // whole library.
  const out: SavedWorkout[] = [];
  for (const row of rows) {
    try {
      out.push({
        id: row.id,
        savedAt: row.savedAt,
        analysisId: row.analysisId ?? undefined,
        tags: JSON.parse(row.tags),
        workout: JSON.parse(row.payload),
      });
    } catch (e) {
      console.warn(`Skipping unreadable workout row ${row.id}:`, e);
    }
  }
  return out;
}

export function deleteWorkout(id: string): void {
  requireDb().prepare(`DELETE FROM workouts WHERE id = ?`).run(id);
}

// ---- Settings ----

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
};

export function getSettings(): AppSettings {
  const d = requireDb();
  const rows = d.prepare(`SELECT key, value FROM settings`).all() as {
    key: string;
    value: string;
  }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return {
    theme: (out.theme as AppSettings["theme"]) ?? DEFAULT_SETTINGS.theme,
  };
}

export function setSettings(partial: Partial<AppSettings>): AppSettings {
  const d = requireDb();
  const current = getSettings();
  const next: AppSettings = { ...current, ...partial };
  const upsert = d.prepare(
    `INSERT INTO settings(key,value) VALUES(?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  );
  const tx = d.transaction((s: AppSettings) => {
    upsert.run("theme", s.theme);
  });
  tx(next);
  return next;
}
