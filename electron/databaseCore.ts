import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const SCHEMA = `
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
`;

const CORRUPTION_CODES = new Set(["SQLITE_CORRUPT", "SQLITE_NOTADB"]);

export interface DatabaseOpenResult {
  database: Database.Database;
  /** Directory containing the original DB/WAL/SHM when corruption recovery ran. */
  recoveredFrom?: string;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function corruptionError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: "SQLITE_CORRUPT" });
}

function openPreparedDatabase(databasePath: string): Database.Database {
  let candidate: Database.Database | undefined;
  try {
    candidate = new Database(databasePath);

    // Fail startup deterministically if the file is damaged. Without this,
    // corruption in a less frequently read page can stay latent until an IPC
    // query and repeatedly break the renderer later in the session.
    const quickCheck = candidate.pragma("quick_check", { simple: true });
    if (quickCheck !== "ok") {
      throw corruptionError(`SQLite quick_check failed: ${String(quickCheck)}`);
    }

    // WAL keeps reads responsive during writes; NORMAL is SQLite's recommended
    // durability/performance pairing for WAL. A finite busy timeout turns brief
    // antivirus/indexer locks into a wait rather than an immediate failed save.
    candidate.pragma("busy_timeout = 5000");
    candidate.pragma("journal_mode = WAL");
    candidate.pragma("synchronous = NORMAL");
    candidate.pragma("foreign_keys = ON");
    candidate.exec(SCHEMA);

    // Remove obsolete secret/model settings from installations predating the
    // fully local coaching engine.
    candidate
      .prepare(`DELETE FROM settings WHERE key IN ('anthropicApiKey','model')`)
      .run();
    return candidate;
  } catch (error) {
    if (candidate?.open) {
      try {
        candidate.close();
      } catch {
        // Preserve the original initialization error.
      }
    }
    throw error;
  }
}

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function nextBackupDirectory(databasePath: string, now: Date): string {
  const parent = path.dirname(databasePath);
  const stem = path.basename(databasePath, path.extname(databasePath));
  const base = path.join(parent, `${stem}-corrupt-${safeTimestamp(now)}`);
  let candidate = base;
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function preserveCorruptDatabase(databasePath: string, now: Date): string {
  if (!fs.existsSync(databasePath)) {
    throw new Error("SQLite reported corruption but the database file is missing");
  }
  const backupDirectory = nextBackupDirectory(databasePath, now);
  fs.mkdirSync(backupDirectory, { recursive: false });
  for (const source of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(source)) {
      fs.renameSync(source, path.join(backupDirectory, path.basename(source)));
    }
  }
  return backupDirectory;
}

/** Open and initialize the application database. If SQLite proves that the
 * file is corrupt/not-a-database, preserve the complete database family and
 * create a fresh store. Other failures (permissions, disk full, native module)
 * are not destructive and remain fatal to startup. */
export function openDatabaseWithRecovery(
  databasePath: string,
  now: Date = new Date(),
): DatabaseOpenResult {
  try {
    return { database: openPreparedDatabase(databasePath) };
  } catch (error) {
    const code = errorCode(error);
    if (!code || !CORRUPTION_CODES.has(code)) throw error;
    const recoveredFrom = preserveCorruptDatabase(databasePath, now);
    return {
      database: openPreparedDatabase(databasePath),
      recoveredFrom,
    };
  }
}
