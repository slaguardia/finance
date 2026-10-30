// Hand-rolled SVG charts (no chart library, per the platform rules). Each chart
// draws into a fixed viewBox and scales to its container's width. Hover a mark
// for its exact value (native SVG <title>).
const NS = "http://www.w3.org/2000/svg";
const PAD = { t: 12, r: 12, b: 26, l: 56 };
let W = 720; // viewBox width; a chart that spans the full page passes a wider one so its text stays the same size

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
  Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(Math.abs(n) >= 10_000 ? 0 : 1)}k` : `$${Math.round(n)}`;

function frame(height: number, max: number) {
  const svg = el("svg", { viewBox: `0 0 ${W} ${height}`, class: "fn-chart", role: "img" });
  const ih = height - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg.append(el("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: "fn-grid" }));
    const t = el("text", { x: PAD.l - 8, y: y(v) + 4, "text-anchor": "end", class: "fn-axis" });
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

/** A line over time. `t` is a timestamp so uneven gaps between dates stay honest. */
export function lineChart(points: LinePoint[], opts: { height?: number; color?: string; width?: number } = {}): SVGSVGElement {
  W = opts.width ?? 720;
  const height = opts.height ?? 220;
  const { svg, y } = frame(height, niceMax(Math.max(...points.map((p) => p.value), 0)));
  if (!points.length) return svg;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t: number) => (t1 === t0 ? (PAD.l + W - PAD.r) / 2 : PAD.l + 10 + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r - 20));
  const color = opts.color ?? SERIES[0];
  svg.append(el("polyline", { points: points.map((p) => `${x(p.t)},${y(p.value)}`).join(" "), class: "fn-line", stroke: color }));
  const every = Math.max(1, Math.ceil(points.length / 8));
  points.forEach((p, i) => {
    svg.append(el("circle", { cx: x(p.t), cy: y(p.value), r: 4, fill: color, class: "fn-dot" }, p.tip ?? `${p.label}: ${p.value}`));
    if (i % every === 0 || i === points.length - 1) xLabel(svg, x(p.t), p.label, height);
  });
  return svg;
}

export type StackGroup = { label: string; parts: Record<string, number>; tip?: string };

/** Stacked vertical bars, one per group; `keys` fixes the stack order and colors. */
export function stackedBars(groups: StackGroup[], keys: string[], opts: { height?: number; width?: number } = {}): SVGSVGElement {
  W = opts.width ?? 720;
  const height = opts.height ?? 220;
  const total = (g: StackGroup) => keys.reduce((s, k) => s + (g.parts[k] ?? 0), 0);
  const { svg, y } = frame(height, niceMax(Math.max(...groups.map(total), 0)));
  const slot = (W - PAD.l - PAD.r) / Math.max(groups.length, 1);
  const bw = Math.min(42, slot * 0.7);
  const every = Math.max(1, Math.ceil(groups.length / 10));
  groups.forEach((g, i) => {
    const cx = PAD.l + slot * i + slot / 2;
    let base = 0;
    keys.forEach((k, ki) => {
      const v = g.parts[k] ?? 0;
      if (!v) return;
      const fmt = v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
      svg.append(el("rect", {
        x: cx - bw / 2, y: y(base + v), width: bw, height: Math.max(0, y(base) - y(base + v)),
        fill: SERIES[ki % SERIES.length], class: "fn-bar",
      }, `${g.label} · ${k}: ${fmt}${g.tip ? `\n${g.tip}` : ""}`));
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
