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
import { BacklogView } from "./views/backlog";
import { startLive } from "./live";
import { icon } from "./icons";

const routes: Record<string, () => View> = {
  "": OverviewView,
  "accounts": AccountsView,
  "account/": AccountView,
  "budget": BudgetView,
  "debt": DebtView,
  "documents": DocumentsView,
  "backlog": BacklogView,
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
    { label: "Backlog", href: "#backlog" },
    { label: "Log", href: "#log" },
  ],
});
registerSW();
decorateChrome();

// Icons on the nav pills + the app icon beside the wordmark, and keep "Overview"
// lit on the home route (the shell doesn't mark the "" route as current).
function decorateChrome(): void {
  const icons: Record<string, string> = { "#": "home", "#accounts": "wallet", "#budget": "pie", "#debt": "down", "#documents": "file", "#backlog": "list", "#log": "clock" };
  for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>(".cap-nav a"))) {
    // The label goes in a span so the phone tab bar can swap in a shorter word where it has one.
    const label = document.createElement("span");
    label.textContent = a.textContent;
    if (a.getAttribute("href") === "#documents") label.dataset.short = "Docs";
    a.replaceChildren(icon(icons[a.getAttribute("href") ?? ""] ?? "home", 18), label);
  }
  const brand = document.querySelector(".brand");
  const logo = document.createElement("img");
  logo.src = "/icon-192.png";
  logo.alt = "";
  brand?.prepend(logo);
  const home = document.querySelector<HTMLAnchorElement>('.cap-nav a[href="#"]');
  const sync = () => home?.classList.toggle("fn-home-on", location.hash.replace(/^#/, "") === "");
  window.addEventListener("hashchange", sync);
  sync();
}

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
