// Hand-rolled SVG charts (no chart library, per the platform rules). Each chart
// draws into a viewBox and scales to its container's width; a chart that spans
// the page passes a wider `width` so its text stays the same size. Hover, focus
// or tap anywhere in a point's column for a card with its value, the change
// since the previous point, and (stacked bars) every part.
import { h, signed, usd2 } from "./fmt";
import { withTip } from "./ui";

const NS = "http://www.w3.org/2000/svg";
const PAD = { t: 14, r: 8, b: 28, l: 52 };
let W = 720;
let uid = 0;

/** Categorical series colors, all from the toolkit's tokens. */
export const SERIES = ["var(--accent)", "var(--link)", "var(--yes)", "var(--maybe)", "var(--no)", "var(--fg-muted)"];

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}
const compact = (n: number) =>
  Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(Math.abs(n) >= 10_000 || n % 1000 === 0 ? 0 : 1)}k` : `$${Math.round(n)}`;

/** Faint horizontal guides + left labels. No frame, no box. */
function frame(height: number, max: number) {
  const svg = el("svg", { viewBox: `0 0 ${W} ${height}`, class: "fn-chart", role: "img" });
  const ih = height - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg.append(el("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: i ? "fn-guide" : "fn-base" }));
    const t = el("text", { x: PAD.l - 10, y: y(v) + 4, "text-anchor": "end", class: "fn-axis" });
    t.textContent = compact(v);
    svg.append(t);
  }
  return { svg, y };
}

function xLabel(svg: SVGSVGElement, x: number, text: string, height: number) {
  const t = el("text", { x, y: height - 8, "text-anchor": "middle", class: "fn-axis" });
  t.textContent = text;
  svg.append(t);
}

/** A hover/focus/tap target covering one point's column, from x0 to x1. */
function hit(x0: number, x1: number, height: number, label: string) {
  const g = el("g", { class: "fn-hit", tabindex: 0, "aria-label": label });
  g.append(el("rect", { x: x0, y: PAD.t, width: Math.max(x1 - x0, 1), height: height - PAD.t - PAD.b, class: "fn-band" }));
  return g;
}

/** The tooltip card: heading, big value, change since the previous point, then optional rows and notes. */
function card(o: { title: string; value: number; prev?: { title: string; value: number }; lowerIsBetter?: boolean; rows?: Node | null; notes?: string[] }): Node[] {
  const d = o.prev ? o.value - o.prev.value : 0;
  const good = o.lowerIsBetter ? d < 0 : d > 0;
  return [
    h("strong", {}, o.title),
    h("div", { class: "fn-tip-value" }, usd2(o.value)),
    o.prev ? h("div", { class: `fn-tip-sub${Math.round(d) ? (good ? " fn-up" : " fn-down") : ""}` },
      Math.round(d) ? `${signed(d)} since ${o.prev.title}` : `No change since ${o.prev.title}`) : null,
    o.rows ?? null,
    ...(o.notes ?? []).map((n) => h("p", { class: "fn-tip-note" }, n)),
  ].filter((n): n is HTMLElement => n !== null);
}

export type LinePoint = { label: string; title: string; value: number; t: number; notes?: string[] };

/** A line over time with a soft fill. `t` is a timestamp so uneven gaps stay honest. */
export function lineChart(points: LinePoint[], opts: { height?: number; color?: string; width?: number; lowerIsBetter?: boolean } = {}): SVGSVGElement {
  W = opts.width ?? 560;
  const height = opts.height ?? 220;
  const { svg, y } = frame(height, niceMax(Math.max(...points.map((p) => p.value), 0) * 1.08));
  if (!points.length) return svg;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t: number) => (t1 === t0 ? (PAD.l + W - PAD.r) / 2 : PAD.l + 16 + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r - 32));
  const color = opts.color ?? SERIES[0];
  const id = `fn-fill-${++uid}`;
  const grad = el("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(el("stop", { offset: "0%", "stop-color": color, "stop-opacity": 0.32 }), el("stop", { offset: "100%", "stop-color": color, "stop-opacity": 0 }));
  const defs = el("defs", {});
  defs.append(grad);
  svg.append(defs);
  const pts = points.map((p) => `${x(p.t)},${y(p.value)}`);
  const floor = y(0);
  svg.append(el("path", { d: `M${x(t0)},${floor} L${pts.join(" L")} L${x(t1)},${floor} Z`, fill: `url(#${id})`, stroke: "none" }));
  svg.append(el("polyline", { points: pts.join(" "), class: "fn-line", stroke: color }));
  const every = Math.max(1, Math.ceil(points.length / 8));
  points.forEach((p, i) => {
    const cx = x(p.t), prev = points[i - 1], next = points[i + 1];
    const g = hit(prev ? (x(prev.t) + cx) / 2 : PAD.l, next ? (cx + x(next.t)) / 2 : W - PAD.r, height, `${p.title}: ${usd2(p.value)}`);
    const dot = el("circle", { cx, cy: y(p.value), r: 5, fill: color, class: "fn-dot" });
    g.append(el("line", { x1: cx, x2: cx, y1: PAD.t, y2: floor, class: "fn-cross" }), dot);
    svg.append(withTip(g, () => card({ ...p, prev, lowerIsBetter: opts.lowerIsBetter }), dot));
    if (i % every === 0 || i === points.length - 1) xLabel(svg, cx, p.label, height);
  });
  return svg;
}

export type StackGroup = { label: string; title: string; parts: Record<string, number>; notes?: string[] };

/** Stacked vertical bars, one per group; `keys` fixes the stack order and colors. Rounded tops. */
export function stackedBars(groups: StackGroup[], keys: string[], opts: { height?: number; width?: number; lowerIsBetter?: boolean; compare?: boolean } = {}): SVGSVGElement {
  W = opts.width ?? 560;
  const height = opts.height ?? 220;
  const total = (g: StackGroup) => keys.reduce((s, k) => s + (g.parts[k] ?? 0), 0);
  const { svg, y } = frame(height, niceMax(Math.max(...groups.map(total), 0) * 1.05));
  const slot = (W - PAD.l - PAD.r) / Math.max(groups.length, 1);
  const bw = Math.min(40, slot * 0.62);
  const every = Math.max(1, Math.ceil(groups.length / 10));
  const color = (k: string) => SERIES[keys.indexOf(k) % SERIES.length];
  groups.forEach((g, i) => {
    const cx = PAD.l + slot * i + slot / 2;
    const live = keys.filter((k) => (g.parts[k] ?? 0) > 0);
    const col = hit(cx - slot / 2, cx + slot / 2, height, `${g.title}: ${usd2(total(g))}`);
    let base = 0, top: SVGElement = col.firstElementChild as SVGElement;
    live.forEach((k, li) => {
      const v = g.parts[k];
      const t = y(base + v), bottom = y(base), x0 = cx - bw / 2;
      const r = li === live.length - 1 ? Math.min(6, bw / 2, bottom - t) : 0;
      // A rect whose top corners are rounded only on the top segment of the stack.
      const d = `M${x0},${bottom} V${t + r} Q${x0},${t} ${x0 + r},${t} H${x0 + bw - r} Q${x0 + bw},${t} ${x0 + bw},${t + r} V${bottom} Z`;
      top = el("path", { d, fill: color(k), class: "fn-bar" });
      col.append(top);
      base += v;
    });
    // Skip the change line when groups hold different parts (card statements close on different days).
    const prev = opts.compare === false ? undefined : groups[i - 1];
    const rows = live.length ? h("div", { class: "fn-tip-parts" }, ...[...live].reverse().flatMap((k) => [
      h("i", { style: `background:${color(k)}` }), h("span", {}, k), h("b", {}, usd2(g.parts[k]))])) : null;
    svg.append(withTip(col, () => card({ title: g.title, value: total(g), prev: prev && { title: prev.title, value: total(prev) },
      lowerIsBetter: opts.lowerIsBetter, rows, notes: g.notes }), top));
    if (i % every === 0 || i === groups.length - 1) xLabel(svg, cx, g.label, height);
  });
  return svg;
}

export function legend(keys: string[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "fn-legend";
  keys.forEach((k, i) => {
    const item = document.createElement("span");
    const sw = document.createElement("i");
    sw.style.background = SERIES[i % SERIES.length];
    item.append(sw, k);
    box.append(item);
  });
  return box;
}
