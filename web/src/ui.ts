// Small layout pieces shared by views (page header, stat tile, section).
import { h } from "./fmt";

export function pageHead(title: string, lede?: string | Node): HTMLElement {
  return h("header", { class: "fn-head" }, h("h1", {}, title), lede ? h("p", { class: "fn-lede" }, lede) : null);
}

export function tile(label: string, value: string | Node, sub?: string | Node, tone?: "up" | "down"): HTMLElement {
  return h("div", { class: `fn-tile${tone ? ` fn-${tone}` : ""}` },
    h("div", { class: "fn-tile-label" }, label),
    h("div", { class: "fn-tile-value" }, value),
    sub ? h("div", { class: "fn-tile-sub" }, sub) : null);
}

export function section(title: string, ...body: (Node | null | false)[]): HTMLElement {
  return h("section", { class: "fn-section" }, h("h2", {}, title), ...body);
}

export const tiles = (...t: HTMLElement[]) => h("div", { class: "fn-tiles" }, ...t);
export const grid2 = (...k: HTMLElement[]) => h("div", { class: "fn-grid2" }, ...k);
export const muted = (s: string) => h("span", { class: "fn-muted" }, s);

export function list(items: (string | Node)[], empty: string): HTMLElement {
  if (!items.length) return h("p", { class: "fn-muted" }, empty);
  return h("ul", { class: "fn-list" }, ...items.map((i) => h("li", {}, i)));
}

/** A small × button that confirms before acting. */
export function removeBtn(what: string, act: () => Promise<unknown>): HTMLElement {
  const b = h("button", { class: "fn-x", title: `Remove ${what}`, "aria-label": `Remove ${what}` }, "×");
  b.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (confirm(`Remove ${what}?`)) await act().catch((err) => alert(err.message));
  });
  return b;
}
