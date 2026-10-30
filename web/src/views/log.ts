import type { View } from "@brainbot/web-toolkit/shell";
import { button, table } from "@brainbot/web-toolkit/components";
import { api, send } from "../api";
import { h } from "../fmt";
import { pageHead, section } from "../ui";

export const LogView = (): View => ({
  async mount(el) {
    const [activity, backups] = await Promise.all([api.activity(), api.backups()]);
    const now = button({
      label: "Back up now",
      onClick: () => send("POST", "/api/backups").then(() => location.reload()).catch((e) => alert(e.message)),
    });
    el.replaceChildren(
      pageHead("Log", "Every change, newest first, and the nightly database backups."),
      section("Backups", h("p", { class: "fn-muted" }, "A snapshot of the database runs every night; stored documents are mirrored alongside it. The last 30 are kept."),
        backups.length
          ? table({ columns: ["Snapshot", "Size"], rows: backups.map((b) => [b.name, `${(b.size / 1024).toFixed(0)} KB`]) })
          : h("p", { class: "fn-muted" }, "No backups yet."),
        now),
      section("Changes", table({
        columns: ["When (UTC)", "What"],
        rows: activity.map((a) => [a.at.slice(0, 16), a.summary]),
      })),
    );
  },
});
