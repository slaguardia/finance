import "@brainbot/web-toolkit/base.css";
import "@brainbot/web-toolkit/components.css";
import "./style.css";
import { mountApp, type View } from "@brainbot/web-toolkit/shell";
import { registerSW } from "@brainbot/web-toolkit/pwa";
import { OverviewView } from "./views/overview";
import { AccountsView, AccountView } from "./views/accounts";
import { BudgetView } from "./views/budget";
import { DebtView } from "./views/debt";
import { DocumentsView } from "./views/documents";
import { LogView } from "./views/log";
import { startLive } from "./live";

const routes: Record<string, () => View> = {
  "": OverviewView,
  "accounts": AccountsView,
  "account/": AccountView,
  "budget": BudgetView,
  "debt": DebtView,
  "documents": DocumentsView,
  "log": LogView,
};

mountApp(routes, {
  title: "finance",
  layout: "sidebar",
  nav: [
    { label: "Overview", href: "#" },
    { label: "Accounts", href: "#accounts" },
    { label: "Budget", href: "#budget" },
    { label: "Debt", href: "#debt" },
    { label: "Documents", href: "#documents" },
    { label: "Log", href: "#log" },
  ],
});
registerSW();

// Same longest-prefix match as the shell, so a live refresh re-renders the view on screen.
startLive(async () => {
  const path = location.hash.replace(/^#/, "");
  const key = Object.keys(routes).filter((k) => path.startsWith(k)).sort((a, b) => b.length - a.length)[0] ?? "";
  const content = document.querySelector<HTMLElement>(".tk-content");
  if (!content) return;
  const next = document.createElement("div");
  await routes[key]().mount(next);
  content.replaceChildren(...next.childNodes);
});
