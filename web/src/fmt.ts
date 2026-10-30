// Number/date formatting + tiny DOM helpers shared by every view.
const c0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const c2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const usd0 = (n: number | null | undefined) => (n == null ? "—" : c0.format(n));
export const usd2 = (n: number | null | undefined) => (n == null ? "—" : c2.format(n));
export const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + c0.format(Math.abs(n));
export const pct = (n: number | null | undefined, d = 0) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);
export const rate = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(2)}%`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (m: number) => MONTHS[m - 1];
/** "2026-10-31" → "Oct 31, 2026" */
export const day = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
/** "2026-10-31" → "Oct 2026" */
export const month = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
export const shortMonth = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ’${String(y).slice(2)}`;
};
export const ordinal = (n: number) => n + (["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10] || "th");
export const todayIso = () => new Date().toLocaleDateString("en-CA"); // local date, YYYY-MM-DD

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}
