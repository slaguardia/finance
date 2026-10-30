// Hand-rolled SVG charts (no chart library, per the platform rules). Each chart
// draws into a viewBox and scales to its container's width; a chart that spans
// the page passes a wider `width` so its text stays the same size. Hover a mark
// for its exact value (native SVG <title>).
const NS = "http://www.w3.org/2000/svg";
const PAD = { t: 14, r: 8, b: 28, l: 52 };
let W = 720;
let uid = 0;

/** Categorical series colors, all from the toolkit's tokens. */
export const SERIES = ["var(--accent)", "var(--link)", "var(--yes)", "var(--maybe)", "var(--no)", "var(--fg-muted)"];

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, title?: string) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (title) { const t = document.createElementNS(NS, "title"); t.textContent = title; e.append(t); }
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

export type LinePoint = { label: string; value: number; tip?: string; t: number };

/** A line over time with a soft fill. `t` is a timestamp so uneven gaps stay honest. */
export function lineChart(points: LinePoint[], opts: { height?: number; color?: string; width?: number } = {}): SVGSVGElement {
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
    svg.append(el("circle", { cx: x(p.t), cy: y(p.value), r: 5, fill: color, class: "fn-dot" }, p.tip ?? `${p.label}: ${p.value}`));
    if (i % every === 0 || i === points.length - 1) xLabel(svg, x(p.t), p.label, height);
  });
  return svg;
}

export type StackGroup = { label: string; parts: Record<string, number>; tip?: string };

/** Stacked vertical bars, one per group; `keys` fixes the stack order and colors. Rounded tops. */
export function stackedBars(groups: StackGroup[], keys: string[], opts: { height?: number; width?: number } = {}): SVGSVGElement {
  W = opts.width ?? 560;
  const height = opts.height ?? 220;
  const total = (g: StackGroup) => keys.reduce((s, k) => s + (g.parts[k] ?? 0), 0);
  const { svg, y } = frame(height, niceMax(Math.max(...groups.map(total), 0) * 1.05));
  const slot = (W - PAD.l - PAD.r) / Math.max(groups.length, 1);
  const bw = Math.min(40, slot * 0.62);
  const every = Math.max(1, Math.ceil(groups.length / 10));
  groups.forEach((g, i) => {
    const cx = PAD.l + slot * i + slot / 2;
    const live = keys.filter((k) => (g.parts[k] ?? 0) > 0);
    let base = 0;
    live.forEach((k, li) => {
      const v = g.parts[k];
      const fmt = v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
      const top = y(base + v), bottom = y(base), x0 = cx - bw / 2;
      const r = li === live.length - 1 ? Math.min(6, bw / 2, bottom - top) : 0;
      // A rect whose top corners are rounded only on the top segment of the stack.
      const d = `M${x0},${bottom} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${bottom} Z`;
      svg.append(el("path", { d, fill: SERIES[keys.indexOf(k) % SERIES.length], class: "fn-bar" },
        `${g.label} · ${k}: ${fmt}${g.tip ? `\n${g.tip}` : ""}`));
      base += v;
    });
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
