// HTTP server: JSON /api/* + /api/me + /healthz, the Claude connector at /mcp,
// and the built PWA at / (SPA fallback). Every write logs one activity line and
// pings /api/events so open pages refresh themselves.
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { NextFunction, Request, Response } from "express";
import { db, filesDir, logActivity } from "./store";
import { accountsWithLatest, debtSeries, missingInfo, netWorthSeries, overview, monthlyOf } from "./calc";
import { listBackups, runBackup } from "./backup";
import { zip } from "./zip";
import { handleMcp } from "./mcp";
import { createKey, listKeys, revokeKey } from "./keys";
import { addBacklog, listBacklog, removeBacklog, updateBacklog } from "./backlog";

const usd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// --- change feed (SSE) ---
const listeners = new Set<Response>();
/** Set while handling a request the Claude connector made, so its changes read "(via Claude)" in the Log. */
const viaClaude = new AsyncLocalStorage<true>();
function changed(summary: string): void {
  if (viaClaude.getStore()) summary += " (via Claude)";
  logActivity(summary);
  for (const res of listeners) res.write(`event: changed\ndata: ${JSON.stringify({ summary })}\n\n`);
}

class Bad extends Error {}

/** A file name safe for storage and headers: no control characters, quotes or backslashes. */
const cleanName = (s: string) => s.replace(/[\x00-\x1f\x7f"\\]/g, "").trim() || "file";
function need<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null || v === "") throw new Bad(`${what} is required`);
  return v;
}

/** Keep only known columns from a request body. */
function pick(body: any, cols: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of cols) if (body && c in body) out[c] = body[c] === "" ? null : body[c];
  return out;
}

/** "amount → 1600, per → week" for the activity log. */
const describe = (fields: Record<string, unknown>) => Object.entries(fields).map(([k, v]) => `${k} → ${v ?? "—"}`).join(", ");

function update(table: string, key: string, id: unknown, fields: Record<string, unknown>): void {
  const cols = Object.keys(fields);
  if (!cols.length) throw new Bad("nothing to update");
  const r = db().prepare(`UPDATE ${table} SET ${cols.map((c) => `${c}=@${c}`).join(", ")} WHERE ${key}=@__id`).run({ ...fields, __id: id });
  if (!r.changes) throw new Bad(`${table} ${id} not found`);
}

const ACCOUNT = ["name", "kind", "institution", "last4", "sort", "closed", "notes"];
const RECURRING = ["name", "frequency", "amount", "due_day", "due_month", "start_date", "category", "active", "notes"];
const INCOME = ["label", "amount", "per"];
const DOCUMENT = ["doc_date", "type", "issuer", "description", "amount", "applied_to", "notes", "drive_url", "added_at"];

function upsertBalance(b: any): void {
  db().prepare(
    `INSERT INTO balances (account_id, as_of, balance, rate, document_id) VALUES (@account_id, @as_of, @balance, @rate, @document_id)
     ON CONFLICT (account_id, as_of) DO UPDATE SET balance=excluded.balance, rate=COALESCE(excluded.rate, balances.rate),
       document_id=COALESCE(excluded.document_id, balances.document_id)`
  ).run({ account_id: need(b.account_id, "account_id"), as_of: need(b.as_of, "as_of"), balance: need(b.balance, "balance"), rate: b.rate ?? null, document_id: b.document_id ?? null });
}

function insert(table: string, fields: Record<string, unknown>): number {
  const cols = Object.keys(fields);
  const r = db().prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => "@" + c).join(", ")})`).run(fields);
  return Number(r.lastInsertRowid);
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  // Only the connector's own in-process calls (from localhost) can carry the tag.
  app.use((req, _res, next) => (req.header("x-via") === "claude" && req.socket.remoteAddress?.match(/^(::ffff:)?127\.0\.0\.1$|^::1$/) ? viaClaude.run(true, next) : next()));

  // --- the Claude connector (outside the Google login; the key is the lock) ---
  app.all(["/mcp", "/mcp/:key"], (req, res) => {
    handleMcp(req, res).catch((e) => { console.error("[mcp]", e); if (!res.headersSent) res.status(500).json({ error: "connector error" }); });
  });

  // --- Claude access keys (behind the Google login like the rest of /api) ---
  app.get("/api/keys", (_req, res) => res.json({ keys: listKeys() }));
  app.post("/api/keys", wrap((req, res) => {
    const k = createKey(String(need(req.body.label, "label")).slice(0, 80));
    // Logged without the live-refresh ping: a re-render would wipe the page showing the key its one time.
    logActivity(`Created Claude access key "${k.label}"`);
    res.status(201).json(k);
  }));
  app.delete("/api/keys/:id", wrap((req, res) => {
    const k = listKeys().find((k) => k.id === req.params.id);
    if (!k || !revokeKey(k.id)) throw new Bad("key not found");
    changed(`Revoked Claude access key "${k.label}"`);
    res.json({ ok: true });
  }));

  // --- backlog: ideas for the app itself ---
  app.get("/api/backlog", (_req, res) => res.json({ backlog: listBacklog() }));
  app.post("/api/backlog", wrap((req, res) => {
    const item = addBacklog(String(need(req.body.title, "title")).trim(), req.body.details?.trim() || null, viaClaude.getStore() ? "claude" : "dashboard");
    changed(`Added to backlog: ${item.title}`);
    res.status(201).json(item);
  }));
  app.patch("/api/backlog/:id", wrap((req, res) => {
    if (req.body.status !== undefined && !["open", "done"].includes(req.body.status)) throw new Bad("status must be open or done");
    const item = updateBacklog(Number(req.params.id), pick(req.body, ["title", "details", "status"]) as any);
    if (!item) throw new Bad("backlog item not found");
    changed(req.body.status === "done" ? `Done: ${item.title}` : req.body.status === "open" ? `Reopened: ${item.title}` : `Updated backlog item: ${item.title}`);
    res.json(item);
  }));
  app.delete("/api/backlog/:id", wrap((req, res) => {
    const item = removeBacklog(Number(req.params.id));
    if (!item) throw new Bad("backlog item not found");
    changed(`Removed from backlog: ${item.title}`);
    res.json({ ok: true });
  }));

  app.get("/api/me", (req, res) => {
    const email = (req.header("X-Auth-Request-Email") || "").trim();
    res.json({ email: email || null });
  });
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.get("/api/events", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    res.write(": hello\n\n");
    listeners.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => { clearInterval(ping); listeners.delete(res); });
  });

  // --- reads ---
  app.get("/api/overview", (_req, res) => res.json(overview()));
  app.get("/api/accounts", (_req, res) => res.json({ accounts: accountsWithLatest() }));
  app.get("/api/accounts/:id", (req, res) => {
    const account = accountsWithLatest().find((a) => a.id === req.params.id);
    if (!account) return res.status(404).json({ error: "account not found" });
    const balances = db().prepare(
      `SELECT b.*, n.note, d.description AS document FROM balances b
       LEFT JOIN period_notes n ON n.as_of=b.as_of LEFT JOIN documents d ON d.id=b.document_id
       WHERE b.account_id=? ORDER BY b.as_of DESC`
    ).all(req.params.id);
    // The latest breakdown (Roth vs pre-tax, funds…), if one was recorded.
    const latest = (db().prepare("SELECT MAX(as_of) AS d FROM breakdowns WHERE account_id=?").get(req.params.id) as any)?.d;
    const breakdown = latest ? {
      as_of: latest,
      rows: db().prepare(`SELECT k.grp AS "group", k.label, k.amount, k.detail, k.document_id, d.description AS document
        FROM breakdowns k LEFT JOIN documents d ON d.id=k.document_id WHERE k.account_id=? AND k.as_of=? ORDER BY k.sort`).all(req.params.id, latest),
    } : null;
    res.json({ account, balances, breakdown });
  });
  // Every balance with its account, for charts that span accounts (e.g. cards by month).
  app.get("/api/balances", (req, res) => {
    const kind = req.query.kind ? String(req.query.kind) : null;
    res.json({
      balances: db().prepare(
        `SELECT b.*, a.name, a.kind, a.institution, n.note FROM balances b JOIN accounts a ON a.id=b.account_id
         LEFT JOIN period_notes n ON n.as_of=b.as_of WHERE (@kind IS NULL OR a.kind=@kind) ORDER BY b.as_of`
      ).all({ kind }),
    });
  });
  app.get("/api/net-worth", (_req, res) => res.json({ series: netWorthSeries() }));
  app.get("/api/debt", (_req, res) => res.json({ series: debtSeries() }));
  app.get("/api/recurring", (_req, res) => {
    const rows = db().prepare("SELECT * FROM recurring ORDER BY active DESC, frequency DESC, amount DESC").all() as any[];
    res.json({ recurring: rows.map((r) => ({ ...r, monthly: monthlyOf(r.amount, r.frequency), missing: missingInfo(r) })) });
  });
  app.get("/api/income", (_req, res) => res.json({ income: db().prepare("SELECT * FROM income").all() }));
  app.get("/api/notes", (_req, res) => res.json({ notes: db().prepare("SELECT * FROM period_notes ORDER BY as_of").all() }));
  // account_ids: the accounts whose balances a document set (comma-separated), which ties a statement to its account.
  app.get("/api/documents", (_req, res) =>
    res.json({ documents: db().prepare(`SELECT d.*, (SELECT group_concat(DISTINCT b.account_id) FROM balances b WHERE b.document_id=d.id) AS account_ids
      FROM documents d ORDER BY COALESCE(d.doc_date, d.added_at) DESC, d.id DESC`).all() }));
  // Every stored statement dated on or after ?since=YYYY-MM-DD, as one zip.
  app.get("/api/documents/export", wrap((req, res) => {
    const since = String(req.query.since ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Bad("since must be a date like 2026-08-01");
    const docs = db().prepare(`SELECT * FROM documents WHERE file_sha IS NOT NULL AND type LIKE '%statement%'
      AND COALESCE(doc_date, added_at) >= ? ORDER BY COALESCE(doc_date, added_at), id`).all(since) as any[];
    const used = new Set<string>();
    const files = docs.filter((d) => fs.existsSync(path.join(filesDir, d.file_sha + d.file_ext))).map((d) => {
      const date = d.doc_date ?? d.added_at;
      const base = `${date} ${[d.issuer, d.description ?? d.type].filter(Boolean).join(" - ")}`.replace(/[\/\\:*?"<>|]+/g, "-").slice(0, 150);
      let name = base + d.file_ext;
      for (let i = 2; used.has(name); i++) name = `${base} (${i})${d.file_ext}`;
      used.add(name);
      return { name, data: fs.readFileSync(path.join(filesDir, d.file_sha + d.file_ext)), date: new Date(`${date}T12:00:00`) };
    });
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename="statements-since-${since}.zip"`);
    res.send(zip(files));
  }));
  app.get("/api/activity", (_req, res) => res.json({ activity: db().prepare("SELECT * FROM activity ORDER BY id DESC LIMIT 200").all() }));
  app.get("/api/backups", (_req, res) => res.json({ backups: listBackups() }));

  // --- writes: accounts + balances ---
  app.post("/api/accounts", wrap((req, res) => {
    const id = need(req.body.id, "id");
    db().prepare(`INSERT INTO accounts (id, name, kind) VALUES (?, ?, ?)`).run(id, need(req.body.name, "name"), need(req.body.kind, "kind"));
    const rest = pick(req.body, ACCOUNT.filter((c) => c !== "name" && c !== "kind"));
    if (Object.keys(rest).length) update("accounts", "id", id, rest);
    changed(`Added account ${req.body.name}`);
    res.status(201).json({ id });
  }));
  app.patch("/api/accounts/:id", wrap((req, res) => {
    const fields = pick(req.body, ACCOUNT);
    update("accounts", "id", req.params.id, fields);
    changed(`Updated account ${req.params.id}: ${describe(fields)}`);
    res.json({ ok: true });
  }));
  // One balance or a batch: {account_id, as_of, balance, rate?, document_id?} or {balances: [...]}.
  app.put("/api/balances", wrap((req, res) => {
    const rows: any[] = Array.isArray(req.body.balances) ? req.body.balances : [req.body];
    db().transaction(() => rows.forEach(upsertBalance))();
    const names = new Map((db().prepare("SELECT id, name FROM accounts").all() as any[]).map((a) => [a.id, a.name]));
    changed(rows.length === 1
      ? `${names.get(rows[0].account_id) ?? rows[0].account_id} ${rows[0].as_of}: ${usd(rows[0].balance)}`
      : `Logged ${rows.length} balances (${[...new Set(rows.map((r) => r.as_of))].join(", ")})`);
    res.json({ ok: true, count: rows.length });
  }));
  app.delete("/api/balances/:account/:as_of", wrap((req, res) => {
    const r = db().prepare("DELETE FROM balances WHERE account_id=? AND as_of=?").run(req.params.account, req.params.as_of);
    if (!r.changes) throw new Bad("balance not found");
    changed(`Removed ${req.params.account} balance for ${req.params.as_of}`);
    res.json({ ok: true });
  }));
  app.put("/api/notes/:as_of", wrap((req, res) => {
    const note = String(req.body.note ?? "").trim();
    if (note) db().prepare("INSERT INTO period_notes (as_of, note) VALUES (?, ?) ON CONFLICT (as_of) DO UPDATE SET note=excluded.note").run(req.params.as_of, note);
    else db().prepare("DELETE FROM period_notes WHERE as_of=?").run(req.params.as_of);
    changed(`Note for ${req.params.as_of}: ${note || "removed"}`);
    res.json({ ok: true });
  }));

  // --- breakdowns: replace one account's split for one date ---
  app.put("/api/breakdowns", wrap((req, res) => {
    const { account_id, as_of, document_id = null } = req.body;
    need(account_id, "account_id"); need(as_of, "as_of");
    const rows = need(req.body.rows, "rows") as any[];
    db().transaction(() => {
      db().prepare("DELETE FROM breakdowns WHERE account_id=? AND as_of=?").run(account_id, as_of);
      rows.forEach((r, i) => insert("breakdowns", {
        account_id, as_of, grp: need(r.group, "group"), label: need(r.label, "label"),
        amount: need(r.amount, "amount"), detail: r.detail ?? null, sort: i, document_id,
      }));
    })();
    changed(`Breakdown for ${account_id} on ${as_of}: ${[...new Set(rows.map((r) => r.group))].join(", ")}`);
    res.json({ ok: true, count: rows.length });
  }));
  app.delete("/api/breakdowns/:account/:as_of", wrap((req, res) => {
    db().prepare("DELETE FROM breakdowns WHERE account_id=? AND as_of=?").run(req.params.account, req.params.as_of);
    changed(`Removed breakdown for ${req.params.account} on ${req.params.as_of}`);
    res.json({ ok: true });
  }));

  // --- writes: recurring + income ---
  app.post("/api/recurring", wrap((req, res) => {
    need(req.body.name, "name"); need(req.body.frequency, "frequency");
    const id = insert("recurring", pick(req.body, RECURRING));
    changed(`Added recurring ${req.body.name} (${usd(req.body.amount)} ${req.body.frequency})`);
    res.status(201).json({ id });
  }));
  // Report what a bill came to for one month (rent, utilities): catalog it as a Bill and make it the bill's current amount.
  app.post("/api/recurring/:id/report", wrap((req, res) => {
    const r = db().prepare("SELECT * FROM recurring WHERE id=?").get(req.params.id) as any;
    if (!r) throw new Bad("bill not found");
    const amount = Number(need(req.body.amount, "amount"));
    const doc_date = String(need(req.body.doc_date, "doc_date"));
    if (!Number.isFinite(amount)) throw new Bad("amount must be a number");
    const id = db().transaction(() => {
      const id = insert("documents", {
        type: "Bill", issuer: r.name, doc_date, amount, description: `${r.name}, ${doc_date.slice(0, 7)}`,
        notes: req.body.notes || null, applied_to: `${r.name} amount → ${usd(amount)}`,
      });
      update("recurring", "id", r.id, { amount });
      return id;
    })();
    changed(`Reported ${r.name} ${usd(amount)} for ${doc_date.slice(0, 7)}`);
    res.status(201).json({ id });
  }));
  app.patch("/api/recurring/:id", wrap((req, res) => {
    const before = db().prepare("SELECT name FROM recurring WHERE id=?").get(req.params.id) as any;
    const fields = pick(req.body, RECURRING);
    update("recurring", "id", req.params.id, fields);
    changed(`Updated recurring ${before?.name ?? req.params.id}: ${describe(fields)}`);
    res.json({ ok: true });
  }));
  app.delete("/api/recurring/:id", wrap((req, res) => {
    const row = db().prepare("SELECT name FROM recurring WHERE id=?").get(req.params.id) as any;
    if (!row) throw new Bad("recurring not found");
    db().prepare("DELETE FROM recurring WHERE id=?").run(req.params.id);
    changed(`Removed recurring ${row.name}`);
    res.json({ ok: true });
  }));
  app.post("/api/income", wrap((req, res) => {
    need(req.body.label, "label"); need(req.body.amount, "amount"); need(req.body.per, "per");
    const id = insert("income", pick(req.body, INCOME));
    changed(`Added income ${req.body.label}: ${usd(req.body.amount)}/${req.body.per}`);
    res.status(201).json({ id });
  }));
  app.patch("/api/income/:id", wrap((req, res) => {
    const before = db().prepare("SELECT label FROM income WHERE id=?").get(req.params.id) as any;
    const fields = pick(req.body, INCOME);
    update("income", "id", req.params.id, fields);
    changed(`Updated income ${before?.label ?? req.params.id}: ${describe(fields)}`);
    res.json({ ok: true });
  }));
  app.delete("/api/income/:id", wrap((req, res) => {
    db().prepare("DELETE FROM income WHERE id=?").run(req.params.id);
    changed(`Removed income ${req.params.id}`);
    res.json({ ok: true });
  }));

  // --- documents: metadata is JSON; the file is a raw PUT body ---
  app.post("/api/documents", wrap((req, res) => {
    const id = insert("documents", pick(req.body, DOCUMENT));
    changed(`Catalogued ${[req.body.issuer, req.body.type].filter(Boolean).join(" ") || "document"} #${id}`);
    res.status(201).json({ id });
  }));
  app.patch("/api/documents/:id", wrap((req, res) => {
    const fields = pick(req.body, DOCUMENT);
    update("documents", "id", req.params.id, fields);
    changed(`Updated document #${req.params.id}: ${describe(fields)}`);
    res.json({ ok: true });
  }));
  app.put("/api/documents/:id/file", express.raw({ type: () => true, limit: "100mb" }), wrap((req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw new Bad("empty file body");
    const name = cleanName(decodeURIComponent(String(req.header("X-Filename") || "file")));
    const sha = crypto.createHash("sha256").update(body).digest("hex");
    const ext = path.extname(name).toLowerCase().slice(0, 10);
    fs.writeFileSync(path.join(filesDir, sha + ext), body);
    update("documents", "id", req.params.id, {
      file_name: name, file_sha: sha, file_ext: ext, size: body.length,
      mime: req.header("Content-Type") || "application/octet-stream",
    });
    changed(`Stored file ${name} on document #${req.params.id}`);
    res.json({ ok: true, sha });
  }));
  app.get("/api/documents/:id/file", (req, res) => {
    const d = db().prepare("SELECT * FROM documents WHERE id=?").get(req.params.id) as any;
    if (!d?.file_sha) return res.status(404).json({ error: "no file stored for this document" });
    res.set("Content-Type", d.mime);
    const name = cleanName(String(d.file_name));
    res.set("Content-Disposition", `inline; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.sendFile(path.join(filesDir, d.file_sha + d.file_ext));
  });
  app.delete("/api/documents/:id", wrap((req, res) => {
    const d = db().prepare("SELECT * FROM documents WHERE id=?").get(req.params.id) as any;
    if (!d) throw new Bad("document not found");
    db().prepare("DELETE FROM documents WHERE id=?").run(req.params.id);
    // The file itself stays on disk and in backups; only the catalog row goes.
    changed(`Removed document #${d.id} (${d.description ?? d.file_name ?? ""})`);
    res.json({ ok: true });
  }));

  // --- bulk import (the one-time sheet migration, or any later batch) ---
  app.post("/api/import", wrap((req, res) => {
    const b = req.body || {};
    const counts: Record<string, number> = {};
    db().transaction(() => {
      for (const a of b.accounts ?? []) {
        db().prepare(`INSERT INTO accounts (id, name, kind, institution, last4, sort, closed, notes)
          VALUES (@id, @name, @kind, @institution, @last4, @sort, @closed, @notes)
          ON CONFLICT (id) DO UPDATE SET name=excluded.name, kind=excluded.kind, institution=excluded.institution,
            last4=excluded.last4, sort=excluded.sort, closed=excluded.closed, notes=excluded.notes`)
          .run({ institution: null, last4: null, sort: 0, closed: 0, notes: null, ...a });
      }
      (b.balances ?? []).forEach(upsertBalance);
      for (const n of b.notes ?? []) db().prepare("INSERT OR REPLACE INTO period_notes (as_of, note) VALUES (?, ?)").run(n.as_of, n.note);
      for (const r of b.recurring ?? []) insert("recurring", pick(r, RECURRING));
      for (const i of b.income ?? []) insert("income", pick(i, INCOME));
      for (const d of b.documents ?? []) insert("documents", pick(d, DOCUMENT));
      for (const k of ["accounts", "balances", "notes", "recurring", "income", "documents"]) counts[k] = (b[k] ?? []).length;
    })();
    changed(`Imported ${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ")}${b.source ? ` from ${b.source}` : ""}`);
    res.json({ ok: true, counts });
  }));

  app.post("/api/backups", wrap(async (_req, res) => res.json(await runBackup())));

  app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

  // --- the built PWA ---
  const dist = path.join(__dirname, "..", "..", "web", "dist");
  const distAlt = path.join(process.cwd(), "web", "dist");
  const root = fs.existsSync(dist) ? dist : distAlt;
  app.use(express.static(root, { index: false }));
  app.get("*", (_req, res) => {
    const index = path.join(root, "index.html");
    if (fs.existsSync(index)) res.sendFile(index);
    else res.status(503).send("PWA not built — run `npm --prefix web run build`.");
  });

  return app;
}

function wrap(fn: (req: Request, res: Response) => unknown) {
  return (req: Request, res: Response, _next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e: any) => {
        const client = e instanceof Bad || /constraint|FOREIGN KEY|UNIQUE|no such column/i.test(e?.message ?? "");
        if (!client) console.error(e);
        res.status(client ? 400 : 500).json({ error: e?.message ?? String(e) });
      });
  };
}
