// SQLite store. Applies numbered migrations at boot, like scout and scribe.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config";

export const filesDir = path.join(config.dataDir, "files");

function applyMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(db.prepare("SELECT name FROM schema_migrations").all().map((r: any) => r.name));
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(f);
    })();
    console.log(`[store] applied migration ${f}`);
  }
}

let _db: Database.Database | null = null;
export function db(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(filesDir, { recursive: true });
  _db = new Database(path.join(config.dataDir, "finance.db"));
  _db.pragma("journal_mode = WAL");
  _db.pragma("busy_timeout = 5000");
  _db.pragma("foreign_keys = ON");
  applyMigrations(_db);
  return _db;
}

export function logActivity(summary: string): void {
  db().prepare("INSERT INTO activity (summary) VALUES (?)").run(summary);
}
