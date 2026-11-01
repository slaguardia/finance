// The Claude connector: an MCP endpoint at /mcp (key in an `Authorization: Bearer`
// header) or /mcp/<key> (for claude.ai, whose custom connectors can't send a
// header). The edge lets /mcp through without the Google login, so the key is
// the only lock. Tools read the record, make safe edits (balances, bills,
// income, accounts), file documents the chat was shown into the catalog, and keep
// the app's backlog. Nothing here deletes, and stored files never leave: a leaked
// key must not hand over tax forms. Each tool calls this app's own /api, so
// writes get the same checks, activity lines and live refresh as the dashboard,
// tagged "via Claude".
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { config } from "./config";
import { checkKey } from "./keys";

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-via": "claude" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  const error = (data as { error?: string }).error;
  if (!res.ok) throw new Error(/FOREIGN KEY/.test(error ?? "") ? "No such account_id. Call list_accounts for the ids." : error ?? `${method} ${path} failed (${res.status})`);
  return data;
}

/** Run an API call and hand Claude the JSON, or the error as a tool error it can read and fix. */
const reply = (p: Promise<unknown>) =>
  p.then((d) => ({ content: [{ type: "text" as const, text: JSON.stringify(d, null, 1) }] }))
    .catch((e: Error) => ({ content: [{ type: "text" as const, text: e.message }], isError: true }));

/** Drop fields Claude left out, so a PATCH only touches what it meant to change. */
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

type Doc = { id: number; applied_to: string | null; file_sha: string | null; [k: string]: unknown };
const documents = () => api("GET", "/api/documents").then((d) => (d as { documents: Doc[] }).documents);
/** Catalog fields only: never the stored file or where it sits on disk. */
const summary = ({ id, doc_date, type, issuer, description, amount, applied_to, notes, file_name, file_sha, added_at, account_ids }: Doc) =>
  ({ id, doc_date, type, issuer, description, amount, applied_to, notes, file_name, has_file: !!file_sha, added_at, account_ids });
/** Claude fills in entries that aren't filed yet; once filed, changes go through the dashboard. */
async function unfiled(id: number): Promise<void> {
  const d = (await documents()).find((x) => x.id === id);
  if (!d) throw new Error(`No document ${id}. Call list_documents for the ids.`);
  if (d.applied_to) throw new Error(`Document ${id} is already filed ("${d.applied_to}"). Only entries not filed yet can be changed here.`);
}

const FREQ = z.enum(["weekly", "biweekly", "monthly", "quarterly", "semiannually", "annually"]);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const billFields = {
  amount: z.number().optional().describe("Amount per payment in dollars"),
  frequency: FREQ.optional(),
  due_day: z.number().int().min(1).max(31).optional().describe("Day of month it's due (monthly and longer)"),
  due_month: z.number().int().min(1).max(12).optional().describe("Any one month it falls in (quarterly, semiannually, annually)"),
  start_date: DATE.optional().describe("Any one date it was or will be paid (weekly, biweekly)"),
  category: z.string().optional().describe("rent, utilities, insurance, debt, subscription, business, fitness, membership, fees, car or other"),
  notes: z.string().optional(),
};

function server(): McpServer {
  const s = new McpServer({ name: "finance", version: "1.0.0" }, {
    instructions:
      "Steven's personal finance record: accounts and balances, debts and rates, recurring bills, income, and net-worth history. " +
      "Amounts are US dollars; dates are YYYY-MM-DD. Read before you write, and say what you changed. " +
      "Every edit shows up in the dashboard's Log, tagged via Claude. Ideas for improving the dashboard itself go on its backlog (add_backlog_item).\n\n" +
      "Filing a document Steven shows you (statement, bill, pay stub, tax form, loan or insurance letter): " +
      "1. Read it fully: issuer, type, document date, period, the amounts that matter, due dates. " +
      "Never write a full account number, SSN or other ID anywhere: account last 4 only. " +
      "2. list_documents with unfiled_only: if an entry matches it (he uploads originals on the Documents page; match by file name and date), use that id; otherwise a new entry is created without a file. " +
      "catalog_document with type (e.g. Statement, Bill, Pay stub, W-2, 1099-INT), issuer, doc_date and a short description. " +
      "3. Apply it, passing document_id: log_balance (new account first with add_account), set_balance_breakdown for splits like Roth vs pre-tax, update_bill or report_bill_payment, update_income. " +
      "If a value conflicts with what's stored, say what's there vs the document and use the document's figure unless it's clearly older. " +
      "4. mark_document_filed with exactly what changed. 5. Tell him in a few lines what it was, what changed, and anything needing attention (a due date, a price increase, an odd charge).",
  });

  // --- reads ---
  s.registerTool("get_overview", {
    description: "Start here. Net worth and its change, total debt by lender, the monthly budget (take-home, fixed bills, what's left), bills due in the next two weeks, and info still missing.",
    annotations: { readOnlyHint: true },
  }, () => reply(api("GET", "/api/overview")));
  s.registerTool("list_accounts", {
    description: "Every account (cash, retirement, insurance cash value, credit cards, loans) with its latest balance, rate and as-of date. Use the id with other tools.",
    annotations: { readOnlyHint: true },
  }, () => reply(api("GET", "/api/accounts")));
  s.registerTool("get_account_history", {
    description: "One account's full balance history (and its latest breakdown, e.g. Roth vs pre-tax), newest first.",
    inputSchema: { account_id: z.string() },
    annotations: { readOnlyHint: true },
  }, ({ account_id }) => reply(api("GET", `/api/accounts/${encodeURIComponent(account_id)}`)));
  s.registerTool("get_budget", {
    description: "Income sources and every recurring payment, with its monthly equivalent, category, due date, whether it's active, and what info is missing.",
    annotations: { readOnlyHint: true },
  }, () => reply(Promise.all([api("GET", "/api/income"), api("GET", "/api/recurring")]).then(([i, r]) => ({ ...(i as object), ...(r as object) }))));
  s.registerTool("get_trends", {
    description: "Net worth over time (with any accounts left out of each point) and debt over time by lender.",
    annotations: { readOnlyHint: true },
  }, () => reply(Promise.all([api("GET", "/api/net-worth"), api("GET", "/api/debt")]).then(([n, d]) => ({ net_worth: n, debt: d }))));
  s.registerTool("get_recent_changes", {
    description: "The latest changes to the record, newest first (the dashboard's Log).",
    inputSchema: { limit: z.number().int().min(1).max(200).optional() },
    annotations: { readOnlyHint: true },
  }, ({ limit }) => reply(api("GET", "/api/activity").then((d) => ({ activity: (d as { activity: unknown[] }).activity.slice(0, limit ?? 30) }))));

  // --- safe edits (nothing deletes) ---
  s.registerTool("log_balance", {
    description: "Record an account's balance on a date. Same date again overwrites that day's value.",
    inputSchema: {
      account_id: z.string(), as_of: DATE, balance: z.number(), rate: z.number().optional().describe("APR %, for loans and cards"),
      document_id: z.number().int().optional().describe("The catalog entry this balance came from"),
    },
  }, (a) => reply(api("PUT", "/api/balances", defined(a)).then(() => ({ ok: true, logged: a }))));
  s.registerTool("add_bill", {
    description: "Add a recurring payment to the budget.",
    inputSchema: { name: z.string(), ...billFields, frequency: FREQ },
  }, (a) => reply(api("POST", "/api/recurring", defined(a))));
  s.registerTool("update_bill", {
    description: "Change a recurring payment: its amount, schedule, category or notes, or set active false to take it out of the budget (it stays in the record).",
    inputSchema: { id: z.number().int(), name: z.string().optional(), ...billFields, active: z.boolean().optional() },
  }, ({ id, active, ...rest }) => reply(api("PATCH", `/api/recurring/${id}`, defined({ ...rest, active: active === undefined ? undefined : Number(active) }))));
  s.registerTool("report_bill_payment", {
    description: "Report what a bill came to for one month (rent, utilities paid by Venmo). It becomes the bill's current amount and is catalogued as a filed Bill.",
    inputSchema: {
      id: z.number().int(), month: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM"), amount: z.number(), notes: z.string().optional(),
      document_id: z.number().int().optional().describe("An uploaded bill not filed yet, to fill in instead of adding a new entry"),
    },
  }, ({ id, month, document_id, ...rest }) => reply((document_id === undefined ? Promise.resolve() : unfiled(document_id))
    .then(() => api("POST", `/api/recurring/${id}/report`, defined({ ...rest, document_id, doc_date: `${month}-01` })))));
  s.registerTool("add_income", {
    description: "Add an income source (take-home, after tax).",
    inputSchema: { label: z.string(), amount: z.number(), per: z.enum(["week", "month", "year"]) },
  }, (a) => reply(api("POST", "/api/income", a)));
  s.registerTool("update_income", {
    description: "Change an income source's label, amount or period.",
    inputSchema: { id: z.number().int(), label: z.string().optional(), amount: z.number().optional(), per: z.enum(["week", "month", "year"]).optional() },
  }, ({ id, ...rest }) => reply(api("PATCH", `/api/income/${id}`, defined(rest))));

  s.registerTool("add_account", {
    description: "Add an account that a document shows but the record doesn't have yet. Then log_balance it.",
    inputSchema: {
      id: z.string().regex(/^[a-z0-9-]+$/, "lowercase-with-dashes").describe("Short slug, e.g. ally-savings"),
      name: z.string(), kind: z.enum(["cash", "investment", "retirement", "insurance", "card", "loan"]),
      institution: z.string().optional(), last4: z.string().regex(/^\d{4}$/, "last 4 digits only").optional(), notes: z.string().optional(),
    },
  }, (a) => reply(api("POST", "/api/accounts", defined(a))));
  s.registerTool("set_balance_breakdown", {
    description: "Record how an account's balance splits on a date (401(k) sources, Roth vs pre-tax, funds). Replaces that date's split.",
    inputSchema: {
      account_id: z.string(), as_of: DATE, document_id: z.number().int().optional(),
      rows: z.array(z.object({ group: z.string().describe("e.g. Source or Fund"), label: z.string(), amount: z.number(), detail: z.string().optional() })).min(1),
    },
  }, (a) => reply(api("PUT", "/api/breakdowns", defined(a))));

  // --- documents: the catalog, never the stored files ---
  s.registerTool("list_documents", {
    description: "The document catalog, newest first: type, issuer, date, description, amount, what it changed, and whether an original file is stored. File contents are never available here.",
    inputSchema: { unfiled_only: z.boolean().optional().describe("Only entries uploaded but not filed yet"), limit: z.number().int().min(1).max(500).optional() },
    annotations: { readOnlyHint: true },
  }, ({ unfiled_only, limit }) => reply(documents().then((ds) => ({
    documents: ds.filter((d) => !unfiled_only || !d.applied_to).slice(0, limit ?? 50).map(summary),
  }))));
  s.registerTool("catalog_document", {
    description: "Describe a document in the catalog. With id, fills in an entry not filed yet (one Steven uploaded); without, adds a new entry with no file. Returns the id to pass as document_id.",
    inputSchema: {
      id: z.number().int().optional(), type: z.string(), issuer: z.string(), doc_date: DATE.describe("The document's own date (statement end, bill date)"),
      description: z.string().describe("Short, e.g. 'Ally savings ••1234, Oct 2026'"), amount: z.number().optional(), notes: z.string().optional(),
    },
  }, ({ id, ...fields }) => reply(id === undefined
    ? api("POST", "/api/documents", defined(fields))
    : unfiled(id).then(() => api("PATCH", `/api/documents/${id}`, defined(fields))).then(() => ({ id }))));
  s.registerTool("mark_document_filed", {
    description: "Last step of filing: record exactly what the document changed (e.g. 'Ally savings 2026-10-31 → $9,412.18'). It then shows as filed.",
    inputSchema: { id: z.number().int(), applied_to: z.string().min(3) },
  }, ({ id, applied_to }) => reply(unfiled(id).then(() => api("PATCH", `/api/documents/${id}`, { applied_to })).then(() => ({ ok: true, id, applied_to }))));

  // --- the app's backlog ---
  s.registerTool("list_backlog", {
    description: "Ideas for improving the finance dashboard itself, open ones first.",
    inputSchema: { include_done: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, ({ include_done }) => reply(api("GET", "/api/backlog").then((d) => {
    const items = (d as { backlog: { status: string }[] }).backlog;
    return { backlog: include_done ? items.sort((a, b) => Number(a.status === "done") - Number(b.status === "done")) : items.filter((i) => i.status === "open") };
  })));
  s.registerTool("add_backlog_item", {
    description: "Add an idea for improving the finance dashboard (a feature, a fix, a better view) to its Backlog page. Check list_backlog first to avoid duplicates.",
    inputSchema: { title: z.string().min(3).max(200).describe("Short, in plain words"), details: z.string().max(4000).optional().describe("Why, and what done looks like") },
  }, (a) => reply(api("POST", "/api/backlog", defined(a))));
  return s;
}

/** POST /mcp or /mcp/:key. Stateless: a fresh server per request, nothing kept between calls. */
export async function handleMcp(req: Request, res: Response): Promise<void> {
  const bearer = req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!checkKey(req.params.key ?? bearer)) {
    res.status(401).json({ error: "missing, wrong or revoked key" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).set("Allow", "POST").json({ error: "use POST" });
    return;
  }
  const s = server();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); s.close(); });
  await s.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
