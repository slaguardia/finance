// Derived numbers. Kept server-side so the PWA and the CLI see the same figures.
import { config } from "./config";
import { db } from "./store";

type Account = { id: string; name: string; kind: string; institution: string | null; closed: number; sort: number };
type Bal = { account_id: string; as_of: string; balance: number; rate: number | null };

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;
// Local (TZ) calendar date, so "today" and backup names follow the owner's clock, not UTC.
export const today = () => new Date().toLocaleDateString("en-CA");

function load() {
  const accounts = db().prepare("SELECT * FROM accounts ORDER BY sort, name").all() as Account[];
  const balances = db().prepare("SELECT account_id, as_of, balance, rate FROM balances ORDER BY as_of").all() as Bal[];
  const byAccount = new Map<string, Bal[]>();
  for (const b of balances) (byAccount.get(b.account_id) ?? byAccount.set(b.account_id, []).get(b.account_id)!).push(b);
  return { accounts, balances, byAccount };
}

/** The latest balance on or before `date`, if one exists. */
function at(rows: Bal[] | undefined, date: string): Bal | undefined {
  let hit: Bal | undefined;
  for (const r of rows ?? []) if (r.as_of <= date) hit = r;
  return hit;
}

const isDebt = (a: Account) => a.kind === "loan";
const isCard = (a: Account) => a.kind === "card";

/**
 * Net worth at a date = fresh asset balances − fresh card balances. A balance
 * older than STALE_DAYS doesn't count; that account is reported as missing.
 */
function netWorthAt(data: ReturnType<typeof load>, date: string) {
  let value = 0;
  const missing: string[] = [];
  for (const a of data.accounts) {
    if (isDebt(a) || a.closed) continue;
    const b = at(data.byAccount.get(a.id), date);
    if (!b || days(b.as_of, date) > config.staleDays) { missing.push(a.id); continue; }
    value += isCard(a) ? -b.balance : b.balance;
  }
  return { value, missing };
}

export function netWorthSeries() {
  const data = load();
  const nonLoan = new Set(data.accounts.filter((a) => !isDebt(a)).map((a) => a.id));
  const assets = data.accounts.filter((a) => !isDebt(a) && !isCard(a) && !a.closed).map((a) => a.id);
  const dates = [...new Set(data.balances.filter((b) => nonLoan.has(b.account_id)).map((b) => b.as_of))].sort();
  // Only plot dates where every open asset account has a fresh value; earlier
  // dates would undercount (most accounts weren't tracked yet).
  return dates
    .map((d) => ({ as_of: d, ...netWorthAt(data, d) }))
    .filter((p) => assets.every((id) => !p.missing.includes(id)));
}

export function debtSeries() {
  const data = load();
  const loans = data.accounts.filter(isDebt);
  const ids = new Set(loans.map((a) => a.id));
  const dates = [...new Set(data.balances.filter((b) => ids.has(b.account_id)).map((b) => b.as_of))].sort();
  return dates.map((d) => {
    const by: Record<string, number> = {};
    for (const a of loans) {
      const b = at(data.byAccount.get(a.id), d);
      if (!b) continue;
      const key = a.institution || a.name;
      by[key] = (by[key] ?? 0) + b.balance;
    }
    return { as_of: d, by, total: Object.values(by).reduce((s, v) => s + v, 0) };
  });
}

export function accountsWithLatest() {
  const data = load();
  return data.accounts.map((a) => {
    const rows = data.byAccount.get(a.id) ?? [];
    const last = rows[rows.length - 1];
    const as_of = last?.as_of ?? null, balance = last?.balance ?? null;
    return { ...a, balance, rate: last?.rate ?? null, as_of, overdue: overdue(a, balance, as_of) };
  });
}

/** An open account not logged recently: 45 days for assets and cards, 90 for loans. Paid-off loans never are. */
function overdue(a: Account, balance: number | null, as_of: string | null): boolean {
  if (a.closed || (isDebt(a) && balance === 0)) return false;
  return !as_of || days(as_of, today()) > (isDebt(a) ? 90 : 45);
}

export const monthlyOf = (amount: number | null, frequency: string) =>
  amount == null ? 0 : frequency === "annually" ? amount / 12 : amount;

export function budget() {
  const income = db().prepare("SELECT * FROM income").all() as { amount: number; per: string }[];
  const take_home = income.reduce((s, r) => s + (r.per === "week" ? (r.amount * 52) / 12 : r.per === "year" ? r.amount / 12 : r.amount), 0);
  const rec = db().prepare("SELECT amount, frequency FROM recurring WHERE active=1").all() as { amount: number | null; frequency: string }[];
  const fixed = rec.reduce((s, r) => s + monthlyOf(r.amount, r.frequency), 0);
  return { take_home, fixed, left_over: take_home - fixed, fixed_share: take_home ? fixed / take_home : null };
}

/** Recurring charges due within `horizon` days of today. */
export function dueSoon(horizon = 14) {
  const now = new Date(today());
  const rows = db().prepare("SELECT * FROM recurring WHERE active=1 AND due_day IS NOT NULL").all() as any[];
  const out: { id: number; name: string; amount: number | null; due: string }[] = [];
  for (const r of rows) {
    for (let i = 0; i <= horizon; i++) {
      const d = new Date(now.getTime() + i * DAY);
      if (d.getUTCDate() !== r.due_day) continue;
      if (r.frequency === "annually" && r.due_month !== d.getUTCMonth() + 1) continue;
      out.push({ id: r.id, name: r.name, amount: r.amount, due: d.toISOString().slice(0, 10) });
      break;
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

/** Things that are out of date or incomplete — the check-in list. */
export function gaps() {
  const out: string[] = [];
  for (const a of accountsWithLatest()) {
    if (!a.overdue) continue;
    out.push(a.as_of ? `${a.name}: last logged ${a.as_of}` : `${a.name}: no balance logged yet`);
  }
  for (const r of db().prepare("SELECT name, amount, due_day FROM recurring WHERE active=1").all() as any[]) {
    if (r.amount == null) out.push(`${r.name}: amount unknown`);
    else if (r.due_day == null) out.push(`${r.name}: due date unknown`);
  }
  return out;
}

export function overview() {
  const nw = netWorthSeries();
  const debt = debtSeries();
  const last = nw[nw.length - 1], prev = nw[nw.length - 2];
  const dl = debt[debt.length - 1], dp = debt[debt.length - 2];
  return {
    net_worth: last ? { value: last.value, as_of: last.as_of, change: prev ? last.value - prev.value : null, prev_as_of: prev?.as_of ?? null } : null,
    debt: dl ? { value: dl.total, as_of: dl.as_of, by: dl.by, change: dp ? dl.total - dp.total : null, prev_as_of: dp?.as_of ?? null } : null,
    budget: budget(),
    net_worth_series: nw,
    debt_series: debt,
    due_soon: dueSoon(),
    gaps: gaps(),
    activity: db().prepare("SELECT * FROM activity ORDER BY id DESC LIMIT 12").all(),
  };
}
