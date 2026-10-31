// The app's own backlog: ideas for making the dashboard better, added from the
// Backlog page or by Claude through the connector. It's about the app, not the
// money, so it lives in a small file beside the database (copied by the nightly
// backup) rather than in the financial record.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

export type BacklogItem = {
  id: number; title: string; details: string | null; status: "open" | "done";
  source: "dashboard" | "claude"; created_at: string; done_at: string | null;
};

export const backlogFile = () => path.join(config.dataDir, "backlog.json");

export function listBacklog(): BacklogItem[] {
  try { return JSON.parse(fs.readFileSync(backlogFile(), "utf8")); } catch { return []; }
}
function save(items: BacklogItem[]): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(backlogFile(), JSON.stringify(items, null, 2));
}

export function addBacklog(title: string, details: string | null, source: BacklogItem["source"]): BacklogItem {
  const items = listBacklog();
  const item: BacklogItem = {
    id: Math.max(0, ...items.map((i) => i.id)) + 1, title, details, status: "open", source,
    created_at: new Date().toISOString(), done_at: null,
  };
  save([...items, item]);
  return item;
}

/** Apply title/details/status changes; null if there's no such item. */
export function updateBacklog(id: number, fields: Partial<Pick<BacklogItem, "title" | "details" | "status">>): BacklogItem | null {
  const items = listBacklog();
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  if (fields.title !== undefined) item.title = fields.title;
  if (fields.details !== undefined) item.details = fields.details;
  if (fields.status !== undefined && fields.status !== item.status) {
    item.status = fields.status;
    item.done_at = fields.status === "done" ? new Date().toISOString() : null;
  }
  save(items);
  return item;
}

export function removeBacklog(id: number): BacklogItem | null {
  const items = listBacklog();
  const item = items.find((i) => i.id === id) ?? null;
  if (item) save(items.filter((i) => i.id !== id));
  return item;
}
