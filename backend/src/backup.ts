// Nightly backups to BACKUP_DIR (bind-mounted to /root/Repositories/backups/finance):
//   finance-YYYY-MM-DD.db   a consistent SQLite snapshot (online backup API), last BACKUP_KEEP kept
//   files/                  a mirror of stored documents (content-addressed, so copy-if-missing)
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { db, filesDir } from "./store";
import { today } from "./calc";

const snapName = (d: string) => `finance-${d}.db`;

export async function runBackup(): Promise<{ file: string; files_copied: number }> {
  fs.mkdirSync(path.join(config.backupDir, "files"), { recursive: true });
  const file = path.join(config.backupDir, snapName(today()));
  await db().backup(file);

  let files_copied = 0;
  for (const f of fs.readdirSync(filesDir)) {
    const dest = path.join(config.backupDir, "files", f);
    if (!fs.existsSync(dest)) { fs.copyFileSync(path.join(filesDir, f), dest); files_copied++; }
  }

  const snaps = listBackups().map((b) => b.name);
  for (const old of snaps.slice(config.backupKeep)) fs.rmSync(path.join(config.backupDir, old));
  console.log(`[backup] ${file} (+${files_copied} files)`);
  return { file: path.basename(file), files_copied };
}

/** Newest first. */
export function listBackups() {
  if (!fs.existsSync(config.backupDir)) return [];
  return fs.readdirSync(config.backupDir)
    .filter((f) => /^finance-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort().reverse()
    .map((name) => ({ name, size: fs.statSync(path.join(config.backupDir, name)).size }));
}

export function scheduleBackups(): void {
  const tick = () => {
    if (new Date().getHours() < config.backupHour) return;
    if (fs.existsSync(path.join(config.backupDir, snapName(today())))) return;
    runBackup().catch((e) => console.error("[backup] failed", e));
  };
  setTimeout(tick, 10_000);
  setInterval(tick, 10 * 60_000);
}
