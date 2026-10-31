import type { View } from "@brainbot/web-toolkit/shell";
import { button, table } from "@brainbot/web-toolkit/components";
import { api, send, type AccessKey } from "../api";
import { day, h } from "../fmt";
import { icon } from "../icons";
import { muted, pageHead, section } from "../ui";

export const LogView = (): View => ({
  async mount(el) {
    const [activity, backups, keys] = await Promise.all([api.activity(), api.backups(), api.keys()]);
    const now = button({
      label: "Back up now",
      onClick: () => send("POST", "/api/backups").then(() => location.reload()).catch((e) => alert(e.message)),
    });
    el.replaceChildren(
      pageHead("Log", "Every change, newest first, the nightly database backups, and who else can reach your numbers."),
      claudeAccess(keys),
      section("Backups", h("p", { class: "fn-muted" }, "A snapshot of the database runs every night; stored documents are mirrored alongside it. The last 30 are kept."),
        backups.length
          ? table({ columns: ["Snapshot", "Size"], rows: backups.map((b) => [b.name, `${(b.size / 1024).toFixed(0)} KB`]) })
          : h("p", { class: "fn-muted" }, "No backups yet."),
        now),
      section("Changes", table({
        columns: ["When (UTC)", "What"],
        rows: activity.map((a) => [h("span", { class: "fn-nowrap" }, a.at.slice(0, 16)), a.summary]),
      })),
    );
  },
});

/** Keys that let a Claude chat read the record and make small edits through /mcp. Revoking one cuts it off at once. */
function claudeAccess(keys: AccessKey[]): HTMLElement {
  const reveal = h("div", { class: "fn-keyreveal", hidden: "" });
  const create = button({ label: "Create a key", variant: "primary", onClick: async () => {
    const label = prompt("Where will you use it? (e.g. claude.ai, laptop Claude Code)");
    if (!label?.trim()) return;
    try {
      const k = await send<{ id: string; label: string; key: string }>("POST", "/api/keys", { label: label.trim() });
      showKey(reveal, k.key);
      list.replaceChildren(keyTable(await api.keys(), list));
    } catch (e) {
      alert((e as Error).message);
    }
  } });
  const list = h("div", {});
  list.append(keyTable(keys, list));
  return section(h("span", {}, icon("key", 16), " Claude access"),
    h("p", { class: "fn-muted fn-note" },
      "A key lets a Claude chat read your balances, debts, bills, income and history, make small edits (log a balance, update a bill or income, report a payment) and add to the backlog. " +
      "It can't delete anything or see documents. Its edits show up below, marked “via Claude”. Revoke a key and it stops working on Claude's next request."),
    list, reveal, h("div", {}, create));
}

function keyTable(keys: AccessKey[], list: HTMLElement): HTMLElement {
  if (!keys.length) return muted("No keys yet, so no Claude chat can reach your numbers.");
  return table({
    columns: ["Key", "Created", "Last used", ""],
    rows: keys.map((k) => [
      k.label,
      day(k.created_at),
      k.last_used_at ? day(k.last_used_at) : "Never",
      button({ label: "Revoke", variant: "danger", onClick: async () => {
        if (!confirm(`Revoke "${k.label}"? Any Claude chat using it loses access right away.`)) return;
        try {
          await send("DELETE", `/api/keys/${k.id}`);
          list.replaceChildren(keyTable(await api.keys(), list));
        } catch (e) {
          alert((e as Error).message);
        }
      } }),
    ]),
  });
}

/** The new key, shown this one time, ready to paste into claude.ai or Claude Code. */
function showKey(box: HTMLElement, key: string): void {
  const url = `${location.origin}/mcp/${key}`;
  const cli = `claude mcp add --transport http finance ${location.origin}/mcp --header "Authorization: Bearer ${key}"`;
  box.replaceChildren(
    h("strong", {}, "Copy this now. It won't be shown again."),
    copyRow("claude.ai: Settings → Connectors → Add custom connector, and paste this as the URL", url),
    copyRow("Claude Code: run this in a terminal", cli),
  );
  box.hidden = false;
}

function copyRow(label: string, value: string): HTMLElement {
  const field = h("input", { class: "fn-input", readonly: "", value, "aria-label": label });
  const copy = h("button", { class: "tk-btn" }, icon("copy", 15), " Copy");
  copy.addEventListener("click", async () => {
    field.select();
    await navigator.clipboard?.writeText(value).catch(() => document.execCommand("copy"));
    copy.lastChild!.textContent = " Copied";
  });
  return h("label", { class: "fn-field" }, label, h("div", { class: "fn-copyrow" }, field, copy));
}
