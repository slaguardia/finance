import type { View } from "@brainbot/web-toolkit/shell";
import { badge, table } from "@brainbot/web-toolkit/components";
import { api } from "../api";
import { day, h, rate, shortMonth, signed, usd0, usd2 } from "../fmt";
import { legend, stackedBars } from "../chart";
import { pageHead, progress, section, tile, tiles } from "../ui";

export const DebtView = (): View => ({
  async mount(el) {
    const [o, accounts] = await Promise.all([api.overview(), api.accounts()]);
    // Open loans first; paid-off ones sink to the bottom.
    const loans = accounts.filter((a) => a.kind === "loan").sort((a, b) => Number(a.balance === 0) - Number(b.balance === 0));
    const ds = o.debt_series;
    const keys = [...new Set(ds.flatMap((p) => Object.keys(p.by)))];
    const last = ds[ds.length - 1], first = ds[0];
    const monthly = loans.reduce((s, a) => s + ((a.balance ?? 0) * (a.rate ?? 0)) / 100 / 12, 0);
    el.replaceChildren(
      pageHead("Debt", "Each loan's history is on its account page: click its name to correct a balance or rate."),
      tiles(
        tile({ label: "Debt left", value: usd0(last?.total), icon: "down", tone: "no", sub: last ? `as of ${day(last.as_of)}` : undefined }),
        tile({ label: "Paid down so far", value: last ? usd0(keys.reduce((s, k) => s + (ds.find((p) => k in p.by)!.by[k] - (last.by[k] ?? 0)), 0)) : "—",
          icon: "check", tone: "yes", sub: first ? `since each lender's first statement` : undefined, trend: "up" }),
        tile({ label: "Interest a month", value: usd2(monthly), icon: "clock", tone: "maybe", sub: "balance × rate ÷ 12" }),
      ),
      section("Debt by lender", stackedBars(ds.map((p) => ({ label: shortMonth(p.as_of), title: day(p.as_of), parts: p.by })), keys, { height: 260, lowerIsBetter: true }), legend(keys)),
      section("Paid down by lender", ...keys.map((k) => {
        const start = ds.find((p) => k in p.by)!.by[k], now = last.by[k] ?? 0, prev = ds.length > 1 ? ds[ds.length - 2].by[k] : undefined;
        const moved = prev != null && Math.round(now - prev) ? ` · ${signed(now - prev)} since the last statement` : "";
        return progress(k, start - now, start, now === 0 ? "Paid off" : `${usd0(now)} left of ${usd0(start)}${moved}`, now === 0 ? "yes" : "link");
      })),
      section("Loans", table({
        columns: ["Loan", "Lender", "Balance", "Rate", "As of", "Status"],
        rows: loans.map((a) => [
          h("a", { href: `#account/${encodeURIComponent(a.id)}` }, a.name),
          a.institution ?? "",
          usd2(a.balance),
          rate(a.rate),
          day(a.as_of),
          a.balance === 0 ? badge("Paid off", "yes") : badge("Open", "info"),
        ]),
        sortable: true,
      })),
    );
  },
});
