// Small layout pieces shared by views (page header, stat tile, card, progress bar).
import { h } from "./fmt";
import { icon } from "./icons";

export function pageHead(title: string, lede?: string | Node): HTMLElement {
  return h("header", { class: "fn-head" }, h("h1", {}, title), lede ? h("p", { class: "fn-lede" }, lede) : null);
}

/** Tone picks the tile's accent: the icon chip's tint and the sub-line color. */
export type Tone = "accent" | "link" | "yes" | "maybe" | "no";

export function tile(o: { label: string; value: string | Node; sub?: string | Node; icon?: string; tone?: Tone; trend?: "up" | "down" }): HTMLElement {
  return h("div", { class: `fn-tile fn-tone-${o.tone ?? "accent"}` },
    h("div", { class: "fn-tile-top" },
      o.icon ? h("span", { class: "fn-chip" }, icon(o.icon, 18)) : null,
      h("span", { class: "fn-tile-label" }, o.label)),
    h("div", { class: "fn-tile-value fn-num" }, o.value),
    o.sub ? h("div", { class: `fn-tile-sub${o.trend ? ` fn-${o.trend}` : ""}` }, o.sub) : null);
}

/** A soft card with a title — every chart, list and table sits in one. */
export function section(title: string | Node, ...body: (Node | string | null | false)[]): HTMLElement {
  return h("section", { class: "fn-card" }, h("h2", {}, title), ...body);
}

export const tiles = (...t: HTMLElement[]) => h("div", { class: "fn-tiles" }, ...t);
export const grid2 = (...k: HTMLElement[]) => h("div", { class: "fn-grid2" }, ...k);
export const grid3 = (...k: HTMLElement[]) => h("div", { class: "fn-grid3" }, ...k);
export const muted = (s: string) => h("span", { class: "fn-muted" }, s);

export function list(items: (string | Node)[], empty: string): HTMLElement {
  if (!items.length) return h("p", { class: "fn-empty" }, icon("check", 16), " ", empty);
  return h("ul", { class: "fn-list" }, ...items.map((i) => h("li", {}, i)));
}

/** A horizontal bar split into colored parts, with a legend underneath. */
export function splitBar(parts: { label: string; value: number; tone?: Tone; color?: string; text?: string }[]): HTMLElement {
  const total = parts.reduce((s, p) => s + Math.max(p.value, 0), 0) || 1;
  return h("div", { class: "fn-split" },
    h("div", { class: "fn-split-bar" }, ...parts.map((p) => {
      const seg = h("span", { class: p.tone ? `fn-bg-${p.tone}` : "", title: `${p.label}: ${p.text ?? p.value}` });
      seg.style.width = `${(Math.max(p.value, 0) / total) * 100}%`;
      if (p.color) seg.style.background = p.color;
      return seg;
    })),
    h("div", { class: "fn-split-legend" }, ...parts.map((p) => {
      const dot = h("i", { class: p.tone ? `fn-bg-${p.tone}` : "" });
      if (p.color) dot.style.background = p.color;
      return h("span", {}, dot, p.label, " ", h("b", { class: "fn-num" }, p.text ?? String(p.value)));
    })));
}

/** A labelled 0–100% progress bar. */
export function progress(label: string | Node, done: number, of: number, right: string, tone: Tone = "yes"): HTMLElement {
  const bar = h("span", { class: `fn-bg-${tone}` });
  bar.style.width = `${of > 0 ? Math.min(100, Math.max(0, (done / of) * 100)) : 0}%`;
  return h("div", { class: "fn-progress" },
    h("div", { class: "fn-progress-head" }, h("span", {}, label), h("span", { class: "fn-num" }, right)),
    h("div", { class: "fn-progress-track" }, bar));
}

/** A small × button that confirms before acting. */
/** A month grid that's wider than the screen opens scrolled to its newest months. */
export function scrolledToEnd(box: HTMLElement): HTMLElement {
  requestAnimationFrame(() => { box.scrollLeft = box.scrollWidth; });
  return box;
}

export function removeBtn(what: string, act: () => Promise<unknown>): HTMLElement {
  const b = h("button", { class: "fn-x", title: `Remove ${what}`, "aria-label": `Remove ${what}` }, "×");
  b.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (confirm(`Remove ${what}?`)) await act().catch((err) => alert(err.message));
  });
  return b;
}

/**
 * A floating tooltip for small targets like the statement grid's icons and chart columns. It lives on <body>, so a
 * scrolling table can't clip it, and sits above `anchor` (default: the target). Hover or keyboard focus shows it. On a touch screen the first tap shows it (with an "Open file"
 * link when the target is a link) and a tap anywhere else closes it. Pass `tap = false` when a tap already does something
 * else (a click-to-edit cell), so touch screens skip the tooltip.
 */
let tipBox: HTMLElement | null = null, tipOwner: Element | null = null;
const hideTip = () => { tipBox?.remove(); tipOwner?.removeAttribute("aria-describedby"); tipBox = tipOwner = null; };

export function withTip<T extends Element>(target: T, content: (touch: boolean) => (Node | string | null)[], anchor: Element = target, tap = true): T {
  if (!document.body.dataset.fnTips) {
    document.body.dataset.fnTips = "1";
    document.addEventListener("pointerdown", (e) => {
      const t = e.target as Node;
      if (tipOwner && !tipOwner.contains(t) && !tipBox?.contains(t)) hideTip();
    }, true);
    addEventListener("scroll", hideTip, true);
    addEventListener("hashchange", hideTip);
  }
  let touch = false;
  const show = () => {
    hideTip();
    const link = touch && target instanceof HTMLAnchorElement;
    tipBox = h("div", { class: `fn-tip${touch ? " fn-tip-touch" : ""}`, id: "fn-tip", role: "tooltip" }, ...content(touch),
      link ? h("a", { class: "fn-tip-open", href: target.href, target: "_blank", rel: "noopener" }, "Open file") : null);
    document.body.append(tipBox);
    tipOwner = target;
    target.setAttribute("aria-describedby", "fn-tip");
    const r = anchor.getBoundingClientRect(), w = tipBox.offsetWidth, ht = tipBox.offsetHeight, vw = document.documentElement.clientWidth;
    tipBox.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8))}px`;
    tipBox.style.top = `${r.top - ht - 8 >= 8 ? r.top - ht - 8 : r.bottom + 8}px`;
  };
  target.addEventListener("pointerenter", (e: Event) => { if (!(e instanceof PointerEvent)) return; touch = e.pointerType !== "mouse"; if (!touch) show(); });
  target.addEventListener("pointerleave", (e: Event) => { if (!(e instanceof PointerEvent)) return; if (e.pointerType === "mouse" && tipOwner === target) hideTip(); });
  target.addEventListener("focus", () => { if (!touch) show(); });
  target.addEventListener("blur", () => { if (!touch && tipOwner === target) hideTip(); });
  if (tap) target.addEventListener("click", (e) => { if (touch && tipOwner !== target) { e.preventDefault(); show(); } });
  return target;
}
