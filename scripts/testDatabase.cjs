const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const {
  openDatabaseWithRecovery,
} = require("../dist-electron/electron/databaseCore.js");

function withTemporaryDatabase(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sport-coach-db-"));
  try {
    run(path.join(directory, "coach.db"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

withTemporaryDatabase((databasePath) => {
  const initial = openDatabaseWithRecovery(databasePath);
  initial.database
    .prepare("INSERT INTO settings(key, value) VALUES (?, ?)")
    .run("anthropicApiKey", "old-secret");
  initial.database.close();

  const reopened = openDatabaseWithRecovery(databasePath);
  assert.equal(reopened.recoveredFrom, undefined);
  assert.equal(reopened.database.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(reopened.database.pragma("synchronous", { simple: true }), 1);
  assert.equal(reopened.database.pragma("busy_timeout", { simple: true }), 5000);
  assert.equal(reopened.database.pragma("foreign_keys", { simple: true }), 1);
  assert.equal(
    reopened.database
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("anthropicApiKey"),
    undefined,
  );
  const tables = reopened.database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.deepEqual(tables, ["analyses", "settings", "workouts"]);
  reopened.database.close();
});

withTemporaryDatabase((databasePath) => {
  const corruptBytes = Buffer.from("this is deliberately not a sqlite database");
  fs.writeFileSync(databasePath, corruptBytes);

  const opened = openDatabaseWithRecovery(
    databasePath,
    new Date("2026-07-15T12:34:56.789Z"),
  );
  assert.ok(opened.recoveredFrom);
  assert.deepEqual(
    fs.readFileSync(path.join(opened.recoveredFrom, "coach.db")),
    corruptBytes,
  );
  assert.equal(opened.database.pragma("quick_check", { simple: true }), "ok");
  assert.deepEqual(
    opened.database.prepare("SELECT COUNT(*) AS count FROM analyses").get(),
    { count: 0 },
  );
  opened.database.close();

  const direct = new Database(databasePath, { readonly: true });
  assert.equal(direct.pragma("quick_check", { simple: true }), "ok");
  direct.close();
});

console.log("Database initialization and corruption recovery verified in Electron");
