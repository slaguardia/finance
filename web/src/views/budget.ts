import type { View } from "@brainbot/web-toolkit/shell";
import { button, table } from "@brainbot/web-toolkit/components";
import { api, send, type Doc, type Recurring } from "../api";
import { h, lastMonths, month, monthName, ordinal, pct, shortMonth, usd0, usd2 } from "../fmt";
import { editable, parseMoney } from "../edit";
import { pageHead, removeBtn, scrolledToEnd, section, splitBar, tile, tiles, withTip } from "../ui";
import { icon } from "../icons";

const PER = [{ value: "week", label: "per week" }, { value: "month", label: "per month" }, { value: "year", label: "per year" }];
const FREQ = [
  { value: "weekly", label: "Weekly" }, { value: "biweekly", label: "Every 2 weeks" }, { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" }, { value: "semiannually", label: "Every 6 months" }, { value: "annually", label: "Yearly" },
];
const byDate = (r: Recurring) => r.frequency === "weekly" || r.frequency === "biweekly";

/** Categories in table order. Each has one color (--cat-* in style.css), used by the bar, the dots and the tags. */
const CATS = ["rent", "utilities", "insurance", "debt", "subscription", "business", "fitness", "membership", "fees"];
const catKey = (r: Recurring) => { const c = (r.category ?? "").toLowerCase(); return CATS.includes(c) ? c : "other"; };
const catLabel = (k: string) => k[0].toUpperCase() + k.slice(1);

/** Where the monthly fixed bills go, one colored segment per category. */
function categoryBar(rows: Recurring[]): HTMLElement {
  const by = new Map<string, number>();
  for (const r of rows.filter((r) => r.active)) by.set(catKey(r), (by.get(catKey(r)) ?? 0) + r.monthly);
  const parts = [...by].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return h("div", { class: "fn-catbar" }, splitBar(parts.map(([k, v]) => ({ label: catLabel(k), value: v, color: `var(--cat-${k})`, text: `${usd0(v)}/mo` }))));
}

export const BudgetView = (): View => ({
  async mount(el) {
    const [income, recurring, o, docs] = await Promise.all([api.income(), api.recurring(), api.overview(), api.documents()]);
    const b = o.budget;
    el.replaceChildren(
      pageHead("Budget", h("span", {}, "Click any value to change it. It saves straight away and everything else updates. ", missingJump(recurring))),
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
      section("Recurring payments", categoryBar(recurring), missingNote(recurring), recurringTable(recurring), button({ label: "+ Add payment", onClick: () => {
        const name = prompt("What is it? (e.g. Netflix)");
        if (name) send("POST", "/api/recurring", { name, frequency: "monthly", category: "subscription" }).catch((e) => alert(e.message));
      } })),
    );
  },
});

const HOME = ["rent", "utilities"];
const isHome = (r: Recurring) => !!r.active && HOME.includes((r.category ?? "").toLowerCase());

/**
 * Rent and utilities, which are paid outside the cards and bank (Venmo), so they're reported here by hand: click a
 * month in the table to report it. Each report is catalogued as a Bill (with the receipt, if attached) and becomes
 * that bill's current amount.
 */
function rentCard(recurring: Recurring[], docs: Doc[]): HTMLElement {
  const bills = recurring.filter(isHome);
  const months = lastMonths(6), now = months[months.length - 1];
  const panel = h("div", { class: "fn-report", hidden: "" });
  const open = (r: Recurring | null, m: string) => {
    panel.replaceChildren(...reportPanel(r, m, () => { panel.hidden = true; }));
    panel.hidden = false;
    panel.querySelector<HTMLInputElement>("input:not([type=file]):not([type=month])")?.focus();
  };
  const reported = (r: Recurring, m: string) => docs.filter((d) => d.type === "Bill" && d.issuer === r.name && d.doc_date?.startsWith(m));
  const cell = (r: Recurring, m: string) => {
    const ds = reported(r, m);
    if (!ds.length) {
      const due = m === now;
      const b = h("button", { type: "button", class: due ? "fn-cell-due" : "fn-cell-add", "aria-label": `Report ${r.name} for ${month(m)}` },
        ...(due ? [icon("plus", 13), "Report"] : [h("span", {}, "·"), h("span", {}, "+")]));
      b.addEventListener("click", () => open(r, m));
      return h("td", {}, withTip(b, () => [h("strong", {}, `${r.name} · ${month(m)}`),
        h("div", { class: "fn-tip-sub" }, `Not reported yet. Click to add it${r.amount != null ? ` (budget ${usd2(r.amount)})` : ""}.`)]));
    }
    const total = ds.reduce((s, d) => s + (d.amount ?? 0), 0);
    const withFile = ds.find((d) => d.file_name);
    const tag = withFile
      ? h("a", { class: "fn-stmt fn-num", href: `/api/documents/${withFile.id}/file`, target: "_blank", rel: "noopener" }, usd0(total))
      : h("span", { class: "fn-stmt fn-num", tabindex: "0" }, usd0(total));
    return h("td", {}, withTip(tag, () => [h("strong", {}, `${r.name} · ${month(m)}`), h("div", { class: "fn-tip-value" }, usd2(total)),
      h("div", { class: "fn-tip-sub" }, withFile ? "Venmo receipt attached" : "No receipt attached"),
      h("div", { class: "fn-tip-foot" }, withFile ? "Click to open the receipt. Fix a wrong amount on the Documents page." : "Fix a wrong amount on the Documents page.")]));
  };
  const grid = bills.length ? scrolledToEnd(h("div", { class: "fn-scroll" }, h("table", { class: "fn-sgrid" },
    h("thead", {}, h("tr", {}, h("th", {}, "Bill"), ...months.map((m) => h("th", {}, shortMonth(m))), h("th", {}, "In budget"))),
    h("tbody", {}, ...bills.map((r) => h("tr", { class: `fn-catrow c-${catKey(r)}` },
      h("td", {}, h("div", { class: "fn-srow" }, h("span", { class: "fn-chip" }, icon(r.category?.toLowerCase() === "rent" ? "home2" : "bolt", 16)), h("div", {}, r.name))),
      ...months.map((m) => cell(r, m)),
      h("td", { class: "fn-num" }, r.amount == null ? "—" : usd2(r.amount)))))))) : h("p", { class: "fn-muted fn-note" }, "Nothing yet. Add your rent or a utility bill to start.");
  const add = h("button", { type: "button", class: "fn-more fn-linkbtn" }, "+ Add a rent or utility bill");
  add.addEventListener("click", () => open(null, now));
  return section(h("span", {}, icon("home2", 16), " Rent & utilities"),
    h("p", { class: "fn-muted fn-note" }, "Paid by Venmo, so they don't show up on a statement. Click a month to report what you paid."),
    grid, panel, add);
}

/** The report panel: which bill and month, the amount (prefilled from the budget), and an optional receipt. */
function reportPanel(r: Recurring | null, m: string, close: () => void): Node[] {
  const name = h("input", { class: "fn-input", placeholder: "e.g. PECO electric" });
  const kind = h("select", { class: "fn-input" }, h("option", { value: "utilities" }, "Utility"), h("option", { value: "rent" }, "Rent"));
  const when = h("input", { class: "fn-input", type: "month" });
  when.value = m;
  const amount = h("input", { class: "fn-input", inputmode: "decimal", placeholder: "$0.00" });
  if (r?.amount != null) amount.value = r.amount.toFixed(2);
  const file = h("input", { type: "file", accept: "image/*,.pdf", hidden: "" });
  const fileName = h("span", {}, "Attach Venmo receipt");
  const pick = h("label", { class: "fn-attach" }, icon("upload", 15), fileName, file);
  file.addEventListener("change", () => { fileName.textContent = file.files?.[0]?.name ?? "Attach Venmo receipt"; pick.classList.toggle("fn-attach-on", !!file.files?.length); });

  const save = button({
    label: "Save", variant: "primary",
    onClick: async () => {
      const amt = parseMoney(amount.value.trim());
      if (amt == null) return alert("Enter the amount.");
      if (!when.value) return alert("Pick the month.");
      save.disabled = true;
      try {
        let id = r ? String(r.id) : "";
        if (!r) {
          if (!name.value.trim()) return alert("Name the bill.");
          id = String((await send<{ id: number }>("POST", "/api/recurring", { name: name.value.trim(), frequency: "monthly", category: kind.value })).id);
        }
        const doc = await send<{ id: number }>("POST", `/api/recurring/${id}/report`, { doc_date: `${when.value}-01`, amount: amt });
        const f = file.files?.[0];
        if (f) await api.uploadFile(doc.id, f);
        // Live refresh waits while an input has focus, and a tap on Save doesn't take it on phones.
        (document.activeElement as HTMLElement | null)?.blur();
        close();
      } catch (e) { alert((e as Error).message); save.disabled = false; }
    },
  });
  const cancel = button({ label: "Cancel", onClick: close });
  return [
    h("div", { class: "fn-report-head" }, h("strong", {}, r ? `Report ${r.name}` : "New rent or utility bill"),
      r?.amount != null ? h("span", { class: "fn-muted" }, `Budget ${usd2(r.amount)} a month`) : null),
    h("div", { class: "fn-report-fields" },
      ...(r ? [] : [h("label", { class: "fn-field" }, "Name", name), h("label", { class: "fn-field" }, "Type", kind)]),
      h("label", { class: "fn-field" }, "Month", when),
      h("label", { class: "fn-field" }, "Amount paid", amount),
      pick),
    h("div", { class: "fn-report-actions" }, save, cancel),
  ];
}

const needsInfo = (rows: Recurring[]) => rows.filter((r) => r.missing.length);

/** A pill under the page title that jumps to the recurring table when something's incomplete. */
function missingJump(rows: Recurring[]): HTMLElement | string {
  const n = needsInfo(rows).length;
  if (!n) return "";
  const b = h("button", { class: "fn-pill fn-pill-maybe fn-pill-inline" }, icon("bell", 14), `${n} payment${n === 1 ? "" : "s"} missing info`);
  b.addEventListener("click", () => document.getElementById("fn-recurring")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  return b;
}

function missingNote(rows: Recurring[]): HTMLElement {
  const n = needsInfo(rows);
  const note = h("p", { class: "fn-muted fn-note", id: "fn-recurring" });
  if (n.length) note.append(icon("bell", 14), ` Highlighted values are missing: ${n.map((r) => `${r.name} (${r.missing.join(", ")})`).join("; ")}.`);
  else note.append("Every active payment has an amount and a due date.");
  return note;
}

function recurringTable(rows: Recurring[]): HTMLElement {
  const patch = (r: Recurring, body: object) => send("PATCH", `/api/recurring/${r.id}`, body);
  // Grouped by category (in CATS order), biggest monthly cost first; inactive ones last.
  const sorted = [...rows].sort((a, b) => (b.active - a.active) || (CATS.indexOf(catKey(a)) + 1 || 99) - (CATS.indexOf(catKey(b)) + 1 || 99) || b.monthly - a.monthly);
  const catOptions = [...new Set([...CATS, ...rows.map((r) => r.category ?? "").filter(Boolean)])].map((c) => ({ value: c, label: catLabel(c) }));
  return table({
    columns: ["Payment", "How often", "Due", "Amount", "Per month", "Category", "Active", ""],
    rows: sorted.map((r) => [
      h("div", { class: `fn-namecell c-${catKey(r)}${r.active ? "" : " fn-off"}` }, h("span", { class: "fn-dot" }),
        editable({ value: r.name, display: r.name, save: (v) => patch(r, { name: v }) })),
      editable({ value: r.frequency, display: FREQ.find((f) => f.value === r.frequency)?.label ?? r.frequency, type: "select", options: FREQ,
        save: (v) => patch(r, { frequency: v }) }),
      byDate(r)
        ? editable({ value: r.start_date ?? "", display: dueText(r) || "Add date", type: "date", missing: r.missing.includes("due date"),
            save: (v) => patch(r, { start_date: v || null }) })
        : editable({
            value: dueText(r, true), display: r.missing.includes("due date") ? (r.due_day ? `${dueText(r)} · add month` : "Add due date") : dueText(r),
            missing: r.missing.includes("due date"),
            placeholder: r.frequency === "monthly" ? "day, e.g. 9" : "a month it's due, e.g. Mar 14",
            save: (v) => patch(r, parseDue(v)),
          }),
      editable({ value: r.amount, display: r.amount == null ? "Add amount" : usd2(r.amount), type: "money", missing: r.amount == null && !!r.active,
        save: (v) => patch(r, { amount: parseMoney(v) }) }),
      h("b", { class: "fn-num" }, usd2(r.monthly)),
      tag(editable({ value: r.category ?? "", display: r.category ? catLabel(r.category) : "Set", type: "select", options: catOptions,
        save: (v) => patch(r, { category: v }) }), catKey(r)),
      editable({ value: String(r.active), display: r.active ? "Yes" : "No", type: "select",
        options: [{ value: "1", label: "Yes" }, { value: "0", label: "No" }], save: (v) => patch(r, { active: Number(v) }) }),
      removeBtn(r.name, () => send("DELETE", `/api/recurring/${r.id}`)),
    ]),
    sortable: true,
  });
}

/** "9th", "Feb 18th", "Mar, Sep 14th", "Fridays", "Every other Fri from Oct 3". `raw` is the editable text. */
const tag = (e: HTMLElement, k: string) => { e.classList.add("fn-cat", `c-${k}`); return e; };

function dueText(r: Recurring, raw = false): string {
  if (byDate(r)) {
    if (!r.start_date) return "";
    const d = new Date(`${r.start_date}T12:00:00`);
    const wd = d.toLocaleDateString("en-US", { weekday: "short" });
    return r.frequency === "weekly" ? `${wd}s` : `Every other ${wd} from ${monthName(d.getMonth() + 1)} ${d.getDate()}`;
  }
  if (r.due_day == null) return "";
  const monthly = r.frequency === "monthly";
  if (raw) return r.due_month && !monthly ? `${monthName(r.due_month)} ${r.due_day}` : String(r.due_day);
  if (monthly || !r.due_month) return ordinal(r.due_day);
  const every = r.frequency === "quarterly" ? 3 : r.frequency === "semiannually" ? 6 : 12;
  const months = Array.from({ length: 12 / every }, (_, i) => ((r.due_month! - 1 + i * every) % 12) + 1).sort((a, b) => a - b);
  return `${months.map(monthName).join(", ")} ${ordinal(r.due_day)}`;
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
