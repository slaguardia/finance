import type { View } from "@brainbot/web-toolkit/shell";
import { api } from "../api";
import { day, h, month, pct, shortMonth, signed, usd0, usd2 } from "../fmt";
import { legend, lineChart, stackedBars } from "../chart";
import { grid2, list, muted, pageHead, section, tile, tiles } from "../ui";

export const OverviewView = (): View => ({
  async mount(el) {
    const [o, cards] = await Promise.all([api.overview(), api.balances("card")]);
    const nw = o.net_worth, debt = o.debt, b = o.budget;

    // Debt change by lender, so a newly added loan doesn't read as the debt going up.
    const ds = o.debt_series, prev = ds[ds.length - 2];
    const lenderMoves = debt && prev
      ? Object.entries(debt.by).map(([k, v]) => [k, v - (prev.by[k] ?? 0), k in prev.by] as const).filter(([, d]) => Math.abs(d) >= 1)
      : [];

    const takeaway = nw
      ? `Net worth is ${usd0(nw.value)}${nw.change != null ? `, ${signed(nw.change)} since ${month(nw.prev_as_of!)}` : ""}. ` +
        `Fixed bills take ${pct(b.fixed_share)} of take-home, leaving ${usd0(b.left_over)} a month.` +
        (o.gaps.length ? ` ${o.gaps.length} thing${o.gaps.length > 1 ? "s" : ""} need${o.gaps.length > 1 ? "" : "s"} updating.` : "")
      : "No balances yet — log some on the Accounts page or send Claude a statement.";

    const cardGroups = groupCards(cards);

    el.replaceChildren(
      pageHead("Overview", takeaway),
      tiles(
        tile("Net worth", nw ? usd0(nw.value) : "—",
          nw ? (nw.change != null ? `${signed(nw.change)} since ${month(nw.prev_as_of!)}` : `as of ${day(nw.as_of)}`) : undefined,
          nw?.change != null ? (nw.change >= 0 ? "up" : "down") : undefined),
        tile("Debt left", debt ? usd0(debt.value) : "—",
          debt ? h("span", {}, ...lenderMoves.map(([k, d, existed], i) =>
            h("span", {}, i ? " · " : "", existed ? `${k} ${signed(d)}` : `${k} added`)), lenderMoves.length ? "" : `as of ${day(debt.as_of)}`) : undefined),
        tile("Take-home / month", usd0(b.take_home), h("a", { href: "#budget" }, "edit income")),
        tile("Fixed bills / month", usd0(b.fixed), `${pct(b.fixed_share)} of take-home`),
        tile("Left after fixed bills", usd0(b.left_over), "per month", b.left_over >= 0 ? "up" : "down"),
      ),
      grid2(
        section("Net worth",
          o.net_worth_series.length
            ? lineChart(o.net_worth_series.map((p) => ({
                label: shortMonth(p.as_of), value: p.value, t: Date.parse(p.as_of),
                tip: `${month(p.as_of)}: ${usd2(p.value)}${p.missing.length ? `\nNot counted (stale): ${p.missing.join(", ")}` : ""}`,
              })))
            : muted("Needs a balance for every asset account on the same date.")),
        section("Debt by lender",
          stackedBars(ds.map((p) => ({ label: shortMonth(p.as_of), parts: p.by })), lenders(ds)),
          legend(lenders(ds))),
      ),
      section("Credit card balances",
        cardGroups.groups.length ? stackedBars(cardGroups.groups, cardGroups.keys, { width: 1400, height: 260 }) : muted("No card balances yet."),
        legend(cardGroups.keys)),
      h("div", { class: "fn-grid3" },
        section("Due in the next two weeks", list(o.due_soon.map((d) =>
          h("span", {}, h("b", {}, d.name), ` ${usd2(d.amount)} · ${day(d.due)}`)), "Nothing due.")),
        section("Needs updating", list(o.gaps, "All caught up.")),
        section("Recent changes", list(o.activity.slice(0, 8).map((a) =>
          h("span", {}, a.summary, " ", muted(day(a.at)))), "No changes yet."), h("a", { href: "#log" }, "full log →")),
      ),
    );
  },
});

const lenders = (ds: { by: Record<string, number> }[]) => [...new Set(ds.flatMap((p) => Object.keys(p.by)))];

function groupCards(rows: { as_of: string; name: string; balance: number; note?: string | null }[]) {
  const keys = [...new Set(rows.map((r) => r.name))];
  const by = new Map<string, { label: string; parts: Record<string, number>; tip?: string }>();
  for (const r of rows) {
    const g = by.get(r.as_of) ?? { label: shortMonth(r.as_of), parts: {}, tip: r.note ?? undefined };
    g.parts[r.name] = r.balance;
    by.set(r.as_of, g);
  }
  return { keys, groups: [...by.values()] };
}
