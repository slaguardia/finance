import type { View } from "@brainbot/web-toolkit/shell";
import { button, table } from "@brainbot/web-toolkit/components";
import { api, send, type Recurring } from "../api";
import { h, monthName, ordinal, pct, usd0, usd2 } from "../fmt";
import { editable, parseMoney } from "../edit";
import { pageHead, removeBtn, section, tile, tiles } from "../ui";

const PER = [{ value: "week", label: "per week" }, { value: "month", label: "per month" }, { value: "year", label: "per year" }];
const FREQ = [{ value: "monthly", label: "Monthly" }, { value: "annually", label: "Yearly" }];

export const BudgetView = (): View => ({
  async mount(el) {
    const [income, recurring, o] = await Promise.all([api.income(), api.recurring(), api.overview()]);
    const b = o.budget;
    el.replaceChildren(
      pageHead("Budget", "Click any value to change it. It saves straight away and everything else updates."),
      tiles(
        tile({ label: "Take-home a month", value: usd0(b.take_home), icon: "wallet", tone: "link" }),
        tile({ label: "Fixed bills a month", value: usd0(b.fixed), icon: "calendar", tone: "maybe", sub: `${pct(b.fixed_share)} of take-home` }),
        tile({ label: "Left after bills", value: usd0(b.left_over), icon: "piggy", tone: "yes", sub: "every month", trend: b.left_over >= 0 ? "up" : "down" }),
      ),
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
