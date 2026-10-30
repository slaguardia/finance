import type { View } from "@brainbot/web-toolkit/shell";
import { button, table } from "@brainbot/web-toolkit/components";
import { api, send, type Doc, type Recurring } from "../api";
import { h, lastMonths, monthName, ordinal, pct, shortMonth, todayIso, usd0, usd2 } from "../fmt";
import { editable, parseMoney } from "../edit";
import { pageHead, removeBtn, section, tile, tiles } from "../ui";
import { icon } from "../icons";

const PER = [{ value: "week", label: "per week" }, { value: "month", label: "per month" }, { value: "year", label: "per year" }];
const FREQ = [{ value: "monthly", label: "Monthly" }, { value: "annually", label: "Yearly" }];

export const BudgetView = (): View => ({
  async mount(el) {
    const [income, recurring, o, docs] = await Promise.all([api.income(), api.recurring(), api.overview(), api.documents()]);
    const b = o.budget;
    el.replaceChildren(
      pageHead("Budget", "Click any value to change it. It saves straight away and everything else updates."),
      tiles(
        tile({ label: "Take-home a month", value: usd0(b.take_home), icon: "wallet", tone: "link" }),
        tile({ label: "Fixed bills a month", value: usd0(b.fixed), icon: "calendar", tone: "maybe", sub: `${pct(b.fixed_share)} of take-home` }),
        tile({ label: "Left after bills", value: usd0(b.left_over), icon: "piggy", tone: "yes", sub: "every month", trend: b.left_over >= 0 ? "up" : "down" }),
      ),
      rentCard(recurring, docs),
      section("Income", table({
        columns: ["Source", "Amount", "", "Per month", ""],
        rows: income.map((i) => [
          editable({ value: i.label, display: i.label, save: (v) => send("PATCH", `/api/income/${i.id}`, { label: v }) }),
          editable({ value: i.amount, display: usd2(i.amount), type: "money", save: (v) => send("PATCH", `/api/income/${i.id}`, { amount: parseMoney(v) }) }),
          editable({ value: i.per, display: PER.find((p) => p.value === i.per)!.label, type: "select", options: PER,
            save: (v) => send("PATCH", `/api/income/${i.id}`, { per: v }) }),
          usd2(i.per === "week" ? (i.amount * 52) / 12 : i.per === "year" ? i.amount / 12 : i.amount),
          removeBtn(i.label, () => send("DELETE", `/api/income/${i.id}`)),
        ]),
      }), button({ label: "+ Add income", onClick: () => {
        const label = prompt("Income source (e.g. Side work)");
        if (label) send("POST", "/api/income", { label, amount: 0, per: "month" }).catch((e) => alert(e.message));
      } })),
      section("Recurring payments", recurringTable(recurring), button({ label: "+ Add payment", onClick: () => {
        const name = prompt("What is it? (e.g. Netflix)");
        if (name) send("POST", "/api/recurring", { name, frequency: "monthly", category: "subscription" }).catch((e) => alert(e.message));
      } })),
    );
  },
});

const HOME = ["rent", "utilities"];
const isHome = (r: Recurring) => !!r.active && HOME.includes((r.category ?? "").toLowerCase());

/**
 * Rent and utilities, which are paid outside the cards and bank (Venmo), so they're reported here by hand: each
 * report is catalogued as a Bill (with the receipt, if attached) and becomes that bill's current amount.
 */
function rentCard(recurring: Recurring[], docs: Doc[]): HTMLElement {
  const bills = recurring.filter(isHome);
  const months = lastMonths(6);
  const reported = (r: Recurring, m: string) => docs.filter((d) => d.type === "Bill" && d.issuer === r.name && d.doc_date?.startsWith(m));
  const grid = bills.length ? h("div", { class: "fn-scroll" }, h("table", { class: "fn-sgrid" },
    h("thead", {}, h("tr", {}, h("th", {}, "Bill"), ...months.map((m) => h("th", {}, shortMonth(m))), h("th", {}, "In budget"))),
    h("tbody", {}, ...bills.map((r) => h("tr", { class: `fn-tone-${r.category?.toLowerCase() === "rent" ? "accent" : "link"}` },
      h("td", {}, h("div", { class: "fn-srow" }, h("span", { class: "fn-chip" }, icon(r.category?.toLowerCase() === "rent" ? "home2" : "bolt", 16)), h("div", {}, r.name))),
      ...months.map((m) => {
        const ds = reported(r, m);
        if (!ds.length) return h("td", {}, h("span", { class: "fn-stmt-none" }, "·"));
        const total = ds.reduce((s, d) => s + (d.amount ?? 0), 0);
        const withFile = ds.find((d) => d.file_name);
        return h("td", {}, withFile
          ? h("a", { class: "fn-stmt fn-num", href: `/api/documents/${withFile.id}/file`, target: "_blank", rel: "noopener" }, usd0(total))
          : h("span", { class: "fn-stmt fn-num" }, usd0(total)));
      }),
      h("td", { class: "fn-num" }, r.amount == null ? "—" : usd2(r.amount))))))) : h("p", { class: "fn-muted fn-note" }, "Nothing yet. Report your rent or a utility bill below to start.");
  return section(h("span", {}, icon("home2", 16), " Rent & utilities"),
    h("p", { class: "fn-muted fn-note" }, "Paid by Venmo, so they don't show up on a statement. Report each month here, with the Venmo receipt if you have it."),
    grid, reportForm(bills));
}

function reportForm(bills: Recurring[]): HTMLElement {
  const which = h("select", { class: "fn-input" },
    ...bills.map((r) => h("option", { value: String(r.id) }, r.name)),
    h("option", { value: "new" }, "New rent or utility…"));
  const name = h("input", { class: "fn-input", placeholder: "Name (e.g. Rent, PECO electric)" });
  const kind = h("select", { class: "fn-input" }, h("option", { value: "rent" }, "Rent"), h("option", { value: "utilities" }, "Utility"));
  const fresh = h("div", { class: "fn-row" }, name, kind);
  const sync = () => { fresh.hidden = which.value !== "new"; };
  which.addEventListener("change", sync);
  sync();
  const month = h("input", { class: "fn-input", type: "month" });
  month.value = todayIso().slice(0, 7);
  const amount = h("input", { class: "fn-input", inputmode: "decimal", placeholder: "Amount" });
  const file = h("input", { class: "fn-input", type: "file", accept: "image/*,.pdf" });
  const save = button({
    label: "Report", variant: "primary",
    onClick: async () => {
      const amt = parseMoney(amount.value.trim());
      if (amt == null) return alert("Enter the amount.");
      if (!month.value) return alert("Pick the month.");
      try {
        let id = which.value;
        if (id === "new") {
          if (!name.value.trim()) return alert("Name the bill.");
          id = String((await send<{ id: number }>("POST", "/api/recurring", { name: name.value.trim(), frequency: "monthly", category: kind.value })).id);
        }
        const doc = await send<{ id: number }>("POST", `/api/recurring/${id}/report`, { doc_date: `${month.value}-01`, amount: amt });
        const f = file.files?.[0];
        if (f) await api.uploadFile(doc.id, f);
      } catch (e) { alert((e as Error).message); }
    },
  });
  return h("div", { class: "fn-report" },
    h("div", { class: "fn-form-grid" },
      h("label", { class: "fn-field" }, "Bill", which),
      h("label", { class: "fn-field" }, "Month", month),
      h("label", { class: "fn-field" }, "Amount", amount),
      h("label", { class: "fn-field" }, "Venmo receipt (optional)", file)),
    fresh, save);
}

function recurringTable(rows: Recurring[]): HTMLElement {
  const patch = (r: Recurring, body: object) => send("PATCH", `/api/recurring/${r.id}`, body);
  return table({
    columns: ["Payment", "How often", "Due", "Amount", "Per month", "Category", "Active", ""],
    rows: rows.map((r) => [
      editable({ value: r.name, display: r.name, save: (v) => patch(r, { name: v }) }),
      editable({ value: r.frequency, display: r.frequency === "annually" ? "Yearly" : "Monthly", type: "select", options: FREQ,
        save: (v) => patch(r, { frequency: v }) }),
      editable({
        value: dueText(r, true), display: dueText(r) || "set", placeholder: r.frequency === "annually" ? "e.g. Feb 18" : "day, e.g. 9",
        save: (v) => patch(r, parseDue(v)),
      }),
      editable({ value: r.amount, display: r.amount == null ? "set" : usd2(r.amount), type: "money", save: (v) => patch(r, { amount: parseMoney(v) }) }),
      usd2(r.monthly),
      editable({ value: r.category ?? "", display: r.category || "—", save: (v) => patch(r, { category: v }) }),
      editable({ value: String(r.active), display: r.active ? "Yes" : "No", type: "select",
        options: [{ value: "1", label: "Yes" }, { value: "0", label: "No" }], save: (v) => patch(r, { active: Number(v) }) }),
      removeBtn(r.name, () => send("DELETE", `/api/recurring/${r.id}`)),
    ]),
    sortable: true,
  });
}

function dueText(r: Recurring, raw = false): string {
  if (r.due_day == null) return "";
  if (raw) return r.due_month ? `${monthName(r.due_month)} ${r.due_day}` : String(r.due_day);
  return r.due_month ? `${monthName(r.due_month)} ${ordinal(r.due_day)}` : ordinal(r.due_day);
}

/** "9", "9th", "Feb 18", "2/18" → {due_day, due_month}. Empty clears it. */
function parseDue(v: string): { due_day: number | null; due_month: number | null } {
  if (!v) return { due_day: null, due_month: null };
  const slash = v.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slash) return { due_month: Number(slash[1]), due_day: Number(slash[2]) };
  const m = v.match(/^(?:([A-Za-z]{3})[a-z]*\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?$/);
  if (!m) throw new Error(`Couldn't read "${v}" as a due date`);
  const mon = m[1] ? ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase()) + 1 : 0;
  if (m[1] && !mon) throw new Error(`Unknown month "${m[1]}"`);
  return { due_day: Number(m[2]), due_month: mon || null };
}
