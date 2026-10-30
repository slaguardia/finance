import type { View } from "@brainbot/web-toolkit/shell";
import { api } from "../api";
import { day, h, month, pct, shortMonth, signed, usd0, usd2 } from "../fmt";
import { legend, lineChart, stackedBars, type StackGroup } from "../chart";
import { icon } from "../icons";
import { grid2, grid3, list, muted, progress, section, splitBar, tile, tiles } from "../ui";

const greeting = () => {
  const hr = new Date().getHours();
  return hr < 5 ? "Up late" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
};
const today = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

export const OverviewView = (): View => ({
  async mount(el) {
    const [o, cards, accounts] = await Promise.all([api.overview(), api.balances("card"), api.accounts()]);
    const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
    const nw = o.net_worth, debt = o.debt, b = o.budget;
    const ds = o.debt_series, prev = ds[ds.length - 2];
    const lenders = [...new Set(ds.flatMap((p) => Object.keys(p.by)))];

    // Debt change by lender, so a newly added loan doesn't read as the debt going up.
    const lenderMoves = debt && prev
      ? Object.entries(debt.by).map(([k, v]) => [k, v - (prev.by[k] ?? 0), k in prev.by] as const).filter(([, d]) => Math.abs(d) >= 1)
      : [];

    const takeaway = nw
      ? `You're worth ${usd0(nw.value)}${nw.change != null ? `, ${nw.change >= 0 ? "up" : "down"} ${usd0(Math.abs(nw.change))} since ${month(nw.prev_as_of!)}` : ""}. ` +
        `Fixed bills take ${pct(b.fixed_share)} of take-home, so ${usd0(b.left_over)} a month is yours to save or spend.`
      : "No balances yet. Log some on the Accounts page or send Claude a statement.";

    const cardGroups = groupCards(cards);

    el.replaceChildren(
      h("header", { class: "fn-hello" },
        h("div", {}, h("p", { class: "fn-date" }, today()), h("h1", {}, `${greeting()} 👋`), h("p", { class: "fn-lede" }, takeaway)),
        o.gaps.length ? jump(h("button", { class: "fn-pill fn-pill-maybe" }, icon("bell", 15), `${o.gaps.length} to update`)) : h("span", { class: "fn-pill fn-pill-yes" }, icon("check", 15), "All up to date")),
      tiles(
        tile({ label: "Net worth", value: nw ? usd0(nw.value) : "—", icon: "coins", tone: "accent",
          sub: nw ? (nw.change != null ? `${signed(nw.change)} since ${month(nw.prev_as_of!)}` : `as of ${day(nw.as_of)}`) : undefined,
          trend: nw?.change != null ? (nw.change >= 0 ? "up" : "down") : undefined }),
        tile({ label: "Debt left", value: debt ? usd0(debt.value) : "—", icon: "down", tone: "no",
          sub: debt ? (lenderMoves.map(([k, d, existed]) => (existed ? `${k} ${signed(d)}` : `${k} added`)).join(" · ") || `as of ${day(debt.as_of)}`) : undefined }),
        tile({ label: "Take-home a month", value: usd0(b.take_home), icon: "wallet", tone: "link", sub: h("a", { href: "#budget" }, "Edit income") }),
        tile({ label: "Left after bills", value: usd0(b.left_over), icon: "piggy", tone: "yes", sub: "every month", trend: b.left_over >= 0 ? "up" : "down" }),
      ),
      section("Where your take-home goes",
        splitBar([
          { label: "Fixed bills", value: b.fixed, tone: "maybe", text: usd0(b.fixed) },
          { label: "Left over", value: b.left_over, tone: "yes", text: usd0(b.left_over) },
        ])),
      grid2(
        section("Net worth",
          o.net_worth_series.length
            ? lineChart(o.net_worth_series.map((p) => ({
                label: shortMonth(p.as_of), title: month(p.as_of), value: p.value, t: Date.parse(p.as_of),
                notes: p.missing.length ? [`Not counted (no fresh balance): ${p.missing.map((id) => nameOf.get(id) ?? id).join(", ")}`] : [],
              })))
            : muted("Needs a balance for every asset account on the same date.")),
        section("Paying down debt",
          ...lenders.map((k) => {
            const first = ds.find((p) => k in p.by)!.by[k], now = debt?.by[k] ?? 0;
            return progress(k, first - now, first, now === 0 ? "Paid off 🎉" : `${usd0(now)} left of ${usd0(first)}`, now === 0 ? "yes" : "link");
          }),
          h("a", { class: "fn-more", href: "#debt" }, "See every loan →")),
      ),
      section("Credit card balances",
        cardGroups.groups.length ? stackedBars(cardGroups.groups, cardGroups.keys, { width: 1400, height: 240, lowerIsBetter: true, compare: false }) : muted("No card balances yet."),
        legend(cardGroups.keys)),
      grid3(
        section(h("span", {}, icon("calendar", 16), " Coming up"), list(o.due_soon.map((d) =>
          h("span", { class: "fn-li" }, h("span", {}, d.name, h("small", {}, day(d.due))), h("b", { class: "fn-num" }, usd2(d.amount)))), "Nothing due in the next two weeks.")),
        h("div", { id: "todo" }, section(h("span", {}, icon("bell", 16), " To update"), list(o.gaps.map((g) => g.replace(/\d{4}-\d{2}-\d{2}/, (d) => day(d))), "Everything's up to date."))),
        section(h("span", {}, icon("clock", 16), " Recent changes"), list(o.activity.slice(0, 6).map((a) =>
          h("span", { class: "fn-li" }, h("span", {}, a.summary, h("small", {}, day(a.at))))), "No changes yet."),
          h("a", { class: "fn-more", href: "#log" }, "Full log →")),
      ),
    );
  },
});

/** The "N to update" pill scrolls to the list (a #hash link would re-route). */
function jump(btn: HTMLElement): HTMLElement {
  btn.addEventListener("click", () => document.getElementById("todo")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  return btn;
}

function groupCards(rows: { as_of: string; name: string; balance: number; note?: string | null }[]) {
  const keys = [...new Set(rows.map((r) => r.name))];
  const by = new Map<string, StackGroup & { notes: string[] }>();
  for (const r of rows) {
    const g = by.get(r.as_of) ?? { label: shortMonth(r.as_of), title: day(r.as_of), parts: {}, notes: [] };
    g.parts[r.name] = r.balance;
    if (r.note) g.notes.push(`${r.name}: ${r.note}`);
    by.set(r.as_of, g);
  }
  return { keys, groups: [...by.values()] };
}
