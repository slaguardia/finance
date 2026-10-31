// Access keys for Claude (the /mcp endpoint). Only a SHA-256 of each key is kept,
// in its own small file beside the database: keys aren't part of the financial
// record, so they stay out of the migrations and the nightly DB snapshots.
// Revoking deletes the hash, so the key stops working on its next request.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

export type AccessKey = { id: string; label: string; hash: string; created_at: string; last_used_at: string | null };

const file = () => path.join(config.dataDir, "access-keys.json");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function load(): AccessKey[] {
  try { return JSON.parse(fs.readFileSync(file(), "utf8")); } catch { return []; }
}
function save(keys: AccessKey[]): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(keys, null, 2), { mode: 0o600 });
}

/** Keys without their hashes, newest first. */
export const listKeys = () => load().map(({ hash: _h, ...k }) => k).reverse();

/** A new key; the raw value is returned once and never stored. */
export function createKey(label: string): { id: string; label: string; key: string } {
  const key = `fin_${crypto.randomBytes(32).toString("base64url")}`;
  const k: AccessKey = { id: crypto.randomBytes(6).toString("hex"), label, hash: sha(key), created_at: new Date().toISOString(), last_used_at: null };
  save([...load(), k]);
  return { id: k.id, label, key };
}

export function revokeKey(id: string): boolean {
  const keys = load();
  const rest = keys.filter((k) => k.id !== id);
  save(rest);
  return rest.length < keys.length;
}

/** The key's label if it's valid (and stamps when it was last used, at most once a minute). */
export function checkKey(raw: string | undefined): string | null {
  if (!raw) return null;
  const keys = load();
  const k = keys.find((k) => k.hash === sha(raw));
  if (!k) return null;
  if (!k.last_used_at || Date.now() - Date.parse(k.last_used_at) > 60_000) {
    k.last_used_at = new Date().toISOString();
    save(keys);
  }
  return k.label;
}
