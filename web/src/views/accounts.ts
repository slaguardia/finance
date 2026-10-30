import type { View } from "@brainbot/web-toolkit/shell";
import { button, table } from "@brainbot/web-toolkit/components";
import { api, send, type Account } from "../api";
import { day, h, month, rate, shortMonth, todayIso, usd0, usd2 } from "../fmt";
import { editable, parseMoney } from "../edit";
import { lineChart } from "../chart";
import { muted, pageHead, removeBtn, section, tile, tiles, type Tone } from "../ui";
import { icon } from "../icons";

const KIND_LABEL: Record<string, string> = {
  cash: "Cash", investment: "Investments", retirement: "Retirement", insurance: "Insurance cash value", card: "Credit cards", loan: "Loans",
};
const KINDS = Object.keys(KIND_LABEL);
/** Each kind gets its own color and icon, so the groups read apart at a glance. */
export const KIND_TONE: Record<string, Tone> = { cash: "yes", investment: "link", retirement: "accent", insurance: "link", card: "maybe", loan: "no" };
export const KIND_ICON: Record<string, string> = { cash: "wallet", investment: "up", retirement: "piggy", insurance: "shield", card: "card", loan: "down" };

export const isDone = (a: Account) => !!a.closed || (a.kind === "loan" && a.balance === 0);
const sum = (as: Account[]) => as.reduce((s, a) => s + (a.balance ?? 0), 0);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export const AccountsView = (): View => ({
  async mount(el) {
    const accounts = await api.accounts();
    const open = accounts.filter((a) => !isDone(a));
    const kinds = KINDS.filter((k) => accounts.some((a) => a.kind === k));
    el.replaceChildren(
      pageHead("Accounts", "Click a balance to correct it, or log a new set of balances below. Click an account for its history."),
      tiles(...kinds.map((k) => {
        const live = open.filter((a) => a.kind === k), late = live.filter((a) => a.overdue).length;
        return tile({
          label: k === "card" ? "Owed on cards" : k === "loan" ? "Left on loans" : KIND_LABEL[k],
          value: usd0(sum(live)), icon: KIND_ICON[k], tone: KIND_TONE[k],
          sub: plural(live.length, "account") + (late ? ` · ${late} to update` : ""),
        });
      })),
      ...kinds.map((k) => group(k, accounts.filter((a) => a.kind === k))),
      logForm(open),
      addAccountForm(),
    );
  },
});

/** One card per kind: a colored header with the group total, then a row per open account. */
function group(k: string, accounts: Account[]): HTMLElement {
  const live = accounts.filter((a) => !isDone(a)), done = accounts.filter(isDone);
  return h("section", { class: `fn-card fn-tone-${KIND_TONE[k]}` },
    h("div", { class: "fn-group-head" },
      h("span", { class: "fn-chip" }, icon(KIND_ICON[k], 18)),
      h("h2", {}, KIND_LABEL[k]),
      h("span", { class: "fn-group-total fn-num" }, usd2(sum(live)))),
    h("div", {}, ...live.map(row)),
    done.length ? h("p", { class: "fn-done" }, icon("check", 14), k === "loan" ? "Paid off:" : "Closed:",
      ...done.map((a) => h("a", { href: `#account/${encodeURIComponent(a.id)}` }, a.name))) : null);
}

function row(a: Account): HTMLElement {
  const meta = [a.institution, a.last4 ? `•••• ${a.last4}` : null, a.rate != null ? `${rate(a.rate)} rate` : null,
    a.as_of ? `as of ${day(a.as_of)}` : "no balance yet"].filter(Boolean).join(" · ");
  return h("div", { class: "fn-acct" },
    h("span", { class: "fn-avatar" }, a.institution ? initials(a.institution) : icon(KIND_ICON[a.kind], 18)),
    h("div", { class: "fn-acct-main" },
      h("a", { href: `#account/${encodeURIComponent(a.id)}` }, a.name),
      h("small", {}, meta, a.overdue ? h("span", { class: "fn-pill fn-pill-maybe fn-pill-sm" }, "Needs update") : null)),
    h("div", { class: "fn-acct-bal fn-num" }, a.as_of ? editable({
      value: a.balance, display: usd2(a.balance), type: "money",
      save: (v) => api.setBalance({ account_id: a.id, as_of: a.as_of!, balance: parseMoney(v) ?? 0 }),
    }) : muted("—")));
}

const initials = (s: string) => s.split(/[\s-]+/).filter((w) => /^[a-z]/i.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

/** One date, one field per open account — how month-end balances get logged by hand. */
function logForm(accounts: Account[]): HTMLElement {
  const date = h("input", { type: "date", class: "fn-input" });
  date.value = todayIso();
  const fields = accounts.map((a) => {
    const input = h("input", { class: "fn-input", inputmode: "decimal", placeholder: a.balance != null ? usd0(a.balance) : "" });
    return { a, input };
  });
  const save = button({
    label: "Save balances", variant: "primary",
    onClick: async () => {
      try {
        const balances = fields.filter((f) => f.input.value.trim()).map((f) => ({
          account_id: f.a.id, as_of: date.value, balance: parseMoney(f.input.value)!,
        }));
        if (!balances.length) return alert("Enter at least one balance.");
        await send("PUT", "/api/balances", { balances });
      } catch (e) { alert((e as Error).message); }
    },
  });
  return section("Log balances",
    h("p", { class: "fn-muted" }, "Leave a field blank to skip that account. Placeholders show the last logged value."),
    h("label", { class: "fn-field" }, "As of ", date),
    h("div", { class: "fn-form-grid" }, ...fields.map((f) => h("label", { class: "fn-field" }, f.a.name, f.input))),
    save);
}

function addAccountForm(): HTMLElement {
  const name = h("input", { class: "fn-input", placeholder: "e.g. Vanguard Brokerage" });
  const kind = h("select", { class: "fn-input" }, ...KINDS.map((k) => h("option", { value: k }, KIND_LABEL[k])));
  const inst = h("input", { class: "fn-input", placeholder: "Institution (optional)" });
  const add = button({
    label: "Add account",
    onClick: () => {
      const n = name.value.trim();
      if (!n) return alert("Name it first.");
      const id = n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      send("POST", "/api/accounts", { id, name: n, kind: kind.value, institution: inst.value.trim() || null }).catch((e) => alert(e.message));
    },
  });
  return section("Add an account", h("div", { class: "fn-row" }, name, kind, inst, add));
}

export const AccountView = (): View => ({
  async mount(el) {
    const id = decodeURIComponent(location.hash.replace(/^#account\//, ""));
    const { account: a, balances } = await api.account(id);
    const pts = [...balances].reverse();
    el.replaceChildren(
      pageHead(a.name, h("span", {}, `${KIND_LABEL[a.kind] ?? a.kind}${a.institution ? ` · ${a.institution}` : ""} · `, h("a", { href: "#accounts" }, "all accounts"))),
      section("History", pts.length ? lineChart(pts.map((b) => ({
        label: shortMonth(b.as_of), value: b.balance, t: Date.parse(b.as_of),
        tip: `${day(b.as_of)}: ${usd2(b.balance)}${b.note ? `\n${b.note}` : ""}`,
      })), { width: 1400, height: 260 }) : muted("No balances yet.")),
      section("Balances", table({
        columns: ["As of", "Balance", "Rate", "Note", "From document", ""],
        rows: balances.map((b) => [
          day(b.as_of),
          editable({ value: b.balance, display: usd2(b.balance), type: "money",
            save: (v) => api.setBalance({ account_id: a.id, as_of: b.as_of, balance: parseMoney(v) ?? 0 }) }),
          editable({ value: b.rate, display: rate(b.rate), type: "number",
            save: (v) => api.setBalance({ account_id: a.id, as_of: b.as_of, balance: b.balance, rate: parseMoney(v) }) }),
          editable({ value: b.note ?? "", display: b.note || "add note", type: "text",
            save: (v) => send("PUT", `/api/notes/${b.as_of}`, { note: v }) }),
          b.document ?? "",
          removeBtn(`the ${month(b.as_of)} balance`, () => send("DELETE", `/api/balances/${encodeURIComponent(a.id)}/${b.as_of}`)),
        ]),
      })),
      section("Details", h("div", { class: "fn-form-grid" },
        h("label", { class: "fn-field" }, "Name", editable({ value: a.name, display: a.name, save: (v) => send("PATCH", `/api/accounts/${a.id}`, { name: v }) })),
        h("label", { class: "fn-field" }, "Type", editable({ value: a.kind, display: KIND_LABEL[a.kind], type: "select",
          options: KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })), save: (v) => send("PATCH", `/api/accounts/${a.id}`, { kind: v }) })),
        h("label", { class: "fn-field" }, "Institution", editable({ value: a.institution ?? "", display: a.institution || "—", save: (v) => send("PATCH", `/api/accounts/${a.id}`, { institution: v }) })),
        h("label", { class: "fn-field" }, "Status", editable({ value: String(a.closed), display: a.closed ? "Closed" : "Open", type: "select",
          options: [{ value: "0", label: "Open" }, { value: "1", label: "Closed" }], save: (v) => send("PATCH", `/api/accounts/${a.id}`, { closed: Number(v) }) })),
      )),
    );
  },
});
