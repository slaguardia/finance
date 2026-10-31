import type { View } from "@brainbot/web-toolkit/shell";
import { button } from "@brainbot/web-toolkit/components";
import { api, send, type BacklogItem } from "../api";
import { day, h } from "../fmt";
import { icon } from "../icons";
import { pageHead, removeBtn, section } from "../ui";

/** Ideas for making the dashboard better, from this page or from a Claude chat through the connector. */
export const BacklogView = (): View => ({
  async mount(el) {
    const items = await api.backlog();
    const open = items.filter((i) => i.status === "open").reverse();
    const done = items.filter((i) => i.status === "done").sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""));
    el.replaceChildren(
      pageHead("Backlog", "Ideas for making this dashboard better. Add one here, or ask Claude to add it in any chat that has your access key."),
      addForm(),
      section(`Open (${open.length})`, open.length
        ? h("ul", { class: "fn-backlog" }, ...open.map(row))
        : h("p", { class: "fn-empty" }, icon("check", 16), " Nothing open. New ideas show up here.")),
      done.length ? h("details", { class: "fn-card fn-backlog-done" },
        h("summary", {}, `Done (${done.length})`),
        h("ul", { class: "fn-backlog" }, ...done.map(row))) : "",
    );
  },
});

function addForm(): HTMLElement {
  const title = h("input", { class: "fn-input", placeholder: "What should be better?", "aria-label": "Idea", maxlength: "200" });
  const details = h("textarea", { class: "fn-input", rows: "2", placeholder: "Details (optional): why, and what done looks like", "aria-label": "Details" });
  const add = button({ label: "Add to backlog", variant: "primary", onClick: async () => {
    if (!title.value.trim()) return title.focus();
    add.disabled = true;
    try {
      await send("POST", "/api/backlog", { title: title.value, details: details.value });
      (document.activeElement as HTMLElement | null)?.blur(); // let the live refresh redraw the list
    } catch (e) {
      alert((e as Error).message);
      add.disabled = false;
    }
  } });
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") add.click(); });
  return section("Add an idea", h("div", { class: "fn-backlog-form" }, title, details, h("div", {}, add)));
}

function row(i: BacklogItem): HTMLElement {
  const isDone = i.status === "done";
  const toggle = h("button", { class: `fn-tick${isDone ? " fn-tick-on" : ""}`, "aria-label": isDone ? `Reopen ${i.title}` : `Mark ${i.title} done`, title: isDone ? "Reopen" : "Mark done" },
    isDone ? icon("check", 14) : "");
  toggle.addEventListener("click", () => send("PATCH", `/api/backlog/${i.id}`, { status: isDone ? "open" : "done" }).catch((e) => alert(e.message)));
  const when = isDone && i.done_at ? `Done ${day(i.done_at)}` : `Added ${day(i.created_at)}${i.source === "claude" ? " by Claude" : ""}`;
  return h("li", { class: isDone ? "fn-backlog-item fn-off" : "fn-backlog-item" },
    toggle,
    h("div", {}, h("strong", {}, i.title), i.details ? h("p", {}, i.details) : null, h("small", {}, when)),
    removeBtn(`"${i.title}" from the backlog`, () => send("DELETE", `/api/backlog/${i.id}`)));
}
