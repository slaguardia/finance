import path from "node:path";

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 8789),
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), "data"),
  backupDir: process.env.BACKUP_DIR || path.join(process.cwd(), "backups"),
  // Nightly snapshot hour (container local time) and how many daily DB snapshots to keep.
  backupHour: num(process.env.BACKUP_HOUR, 4),
  backupKeep: num(process.env.BACKUP_KEEP, 30),
  // A balance older than this no longer counts toward net worth (it shows as a gap instead).
  staleDays: num(process.env.STALE_DAYS, 92),
};
