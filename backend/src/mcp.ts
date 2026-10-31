// The Claude connector: an MCP endpoint at /mcp (key in an `Authorization: Bearer`
// header) or /mcp/<key> (for claude.ai, whose custom connectors can't send a
// header). The edge lets /mcp through without the Google login, so the key is
// the only lock. Tools read the record and make safe edits (balances, bills,
// income) and keep the app's backlog; nothing here deletes, and documents stay out. Each tool calls this
// app's own /api, so writes get the same checks, activity lines and live refresh
// as the dashboard, tagged "via Claude".
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
      "Every edit shows up in the dashboard's Log, tagged via Claude. Ideas for improving the dashboard itself go on its backlog (add_backlog_item).",
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
    inputSchema: { account_id: z.string(), as_of: DATE, balance: z.number(), rate: z.number().optional().describe("APR %, for loans and cards") },
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
    description: "Report what a bill came to for one month (rent, utilities paid by Venmo). It becomes the bill's current amount.",
    inputSchema: { id: z.number().int(), month: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM"), amount: z.number(), notes: z.string().optional() },
  }, ({ id, month, ...rest }) => reply(api("POST", `/api/recurring/${id}/report`, defined({ ...rest, doc_date: `${month}-01` }))));
  s.registerTool("add_income", {
    description: "Add an income source (take-home, after tax).",
    inputSchema: { label: z.string(), amount: z.number(), per: z.enum(["week", "month", "year"]) },
  }, (a) => reply(api("POST", "/api/income", a)));
  s.registerTool("update_income", {
    description: "Change an income source's label, amount or period.",
    inputSchema: { id: z.number().int(), label: z.string().optional(), amount: z.number().optional(), per: z.enum(["week", "month", "year"]).optional() },
  }, ({ id, ...rest }) => reply(api("PATCH", `/api/income/${id}`, defined(rest))));

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
