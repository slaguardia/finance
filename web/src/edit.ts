// Click-to-edit values. A value renders as text; clicking swaps in an input.
// Enter or blur saves, Esc cancels. The server's change event then refreshes the view.
import { h } from "./fmt";

export type EditOpts = {
  value: string | number | null;
  display: string;
  type?: "money" | "number" | "text" | "date" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** Highlight it as information still to fill in. */
  missing?: boolean;
  /** The display is a placeholder ("Add note"), shown faint. */
  empty?: boolean;
  save: (v: string) => Promise<unknown>;
};

export function editable(o: EditOpts): HTMLElement {
  const span = h("span", { class: `fn-edit${o.missing ? " fn-missing" : ""}${o.empty ? " fn-edit-empty" : ""}`, tabindex: "0", title: "Click to edit" }, o.display);
  const open = () => {
    let input: HTMLInputElement | HTMLSelectElement;
    if (o.type === "select") {
      input = h("select", { class: "fn-input" });
      for (const opt of o.options ?? []) {
        const el = h("option", { value: opt.value }, opt.label);
        if (String(o.value) === opt.value) el.selected = true;
        input.append(el);
      }
    } else {
      input = h("input", {
        class: "fn-input",
        type: o.type === "date" ? "date" : "text",
        inputmode: o.type === "money" || o.type === "number" ? "decimal" : "text",
        placeholder: o.placeholder ?? "",
      });
      input.value = o.value == null ? "" : String(o.value);
    }
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (!commit || v === (o.value == null ? "" : String(o.value))) return input.replaceWith(span);
      input.disabled = true;
      try {
        await o.save(v);
        span.textContent = "…";
        input.replaceWith(span);
      } catch (e) {
        alert(`Couldn't save: ${(e as Error).message}`);
        input.replaceWith(span);
      }
    };
    input.addEventListener("keydown", (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === "Enter") finish(true);
      if (k === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    if (o.type === "select") input.addEventListener("change", () => finish(true));
    span.replaceWith(input);
    input.focus();
    if (input instanceof HTMLInputElement) input.select();
  };
  span.addEventListener("click", open);
  span.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
  return span;
}

/** "$1,234.50" / "1234.5" → 1234.5; "" → null. Throws on junk. */
export function parseMoney(v: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[$,\s]/g, ""));
  if (Number.isNaN(n)) throw new Error(`"${v}" isn't a number`);
  return n;
}
