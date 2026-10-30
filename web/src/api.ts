// Thin wrappers over the backend's /api/* (the app's whole control surface).
export type Account = {
  id: string; name: string; kind: string; institution: string | null; last4: string | null;
  sort: number; closed: number; notes: string | null; balance: number | null; rate: number | null; as_of: string | null; overdue: boolean;
};
export type Balance = { account_id: string; as_of: string; balance: number; rate: number | null; note?: string | null; document?: string | null };
export type Recurring = {
  id: number; name: string; frequency: "monthly" | "annually"; amount: number | null; due_day: number | null;
  due_month: number | null; category: string | null; active: number; notes: string | null; monthly: number;
};
export type Income = { id: number; label: string; amount: number; per: "week" | "month" | "year" };
export type Doc = {
  id: number; added_at: string; doc_date: string | null; type: string | null; issuer: string | null; description: string | null;
  amount: number | null; applied_to: string | null; notes: string | null; drive_url: string | null;
  file_name: string | null; mime: string | null; size: number | null; account_ids: string | null;
};
export type Activity = { id: number; at: string; summary: string };
export type DebtPoint = { as_of: string; by: Record<string, number>; total: number };
export type Overview = {
  net_worth: { value: number; as_of: string; change: number | null; prev_as_of: string | null } | null;
  debt: { value: number; as_of: string; by: Record<string, number>; change: number | null; prev_as_of: string | null } | null;
  budget: { take_home: number; fixed: number; left_over: number; fixed_share: number | null };
  net_worth_series: { as_of: string; value: number; missing: string[] }[];
  debt_series: DebtPoint[];
  due_soon: { id: number; name: string; amount: number | null; due: string }[];
  gaps: string[];
  activity: Activity[];
};

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}
const get = <T>(p: string) => fetch(p).then((r) => j<T>(r));
export const send = <T = { ok: true }>(method: string, p: string, body?: unknown) =>
  fetch(p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => j<T>(r));

export const api = {
  overview: () => get<Overview>("/api/overview"),
  accounts: () => get<{ accounts: Account[] }>("/api/accounts").then((d) => d.accounts),
  account: (id: string) => get<{ account: Account; balances: Balance[] }>(`/api/accounts/${encodeURIComponent(id)}`),
  balances: (kind?: string) => get<{ balances: (Balance & { name: string; kind: string })[] }>(`/api/balances${kind ? `?kind=${kind}` : ""}`).then((d) => d.balances),
  recurring: () => get<{ recurring: Recurring[] }>("/api/recurring").then((d) => d.recurring),
  income: () => get<{ income: Income[] }>("/api/income").then((d) => d.income),
  documents: () => get<{ documents: Doc[] }>("/api/documents").then((d) => d.documents),
  activity: () => get<{ activity: Activity[] }>("/api/activity").then((d) => d.activity),
  backups: () => get<{ backups: { name: string; size: number }[] }>("/api/backups").then((d) => d.backups),
  setBalance: (b: { account_id: string; as_of: string; balance: number; rate?: number | null }) => send("PUT", "/api/balances", b),
  uploadFile: (id: number, file: File) =>
    fetch(`/api/documents/${id}/file`, {
      method: "PUT", body: file,
      headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": encodeURIComponent(file.name) },
    }).then((r) => j(r)),
};
