import type { View } from "@brainbot/web-toolkit/shell";
import { button, table } from "@brainbot/web-toolkit/components";
import { api, send, type Doc } from "../api";
import { day, h, todayIso, usd2 } from "../fmt";
import { editable, parseMoney } from "../edit";
import { pageHead, removeBtn, section } from "../ui";
import { icon } from "../icons";

export const DocumentsView = (): View => ({
  async mount(el) {
    const docs = await api.documents();
    el.replaceChildren(
      pageHead("Documents", "Every statement, bill and form, with what it changed. Drop files here, then ask Claude to file them."),
      uploadForm(),
      section(`Catalog (${docs.length})`, table({
        columns: ["Date", "Type", "From", "Description", "Amount", "Applied to", "Notes", ""],
        rows: docs.map((d) => [
          day(d.doc_date ?? d.added_at),
          editable({ value: d.type ?? "", display: d.type || "—", save: (v) => patch(d, { type: v }) }),
          editable({ value: d.issuer ?? "", display: d.issuer || "—", save: (v) => patch(d, { issuer: v }) }),
          link(d),
          editable({ value: d.amount, display: d.amount == null ? "—" : usd2(d.amount), type: "money", save: (v) => patch(d, { amount: parseMoney(v) }) }),
          d.applied_to || h("span", { class: "fn-pill fn-pill-maybe fn-pill-sm" }, "Not filed yet"),
          editable({ value: d.notes ?? "", display: d.notes || "—", save: (v) => patch(d, { notes: v }) }),
          removeBtn(`document #${d.id} from the catalog`, () => send("DELETE", `/api/documents/${d.id}`)),
        ]),
        sortable: true,
      })),
    );
  },
});

const baseName = (f: File) => f.name.replace(/\.[^.]+$/, "");
const patch = (d: Doc, body: object) => send("PATCH", `/api/documents/${d.id}`, body);

function link(d: Doc): Node {
  const text = d.description || d.file_name || `Document #${d.id}`;
  if (d.file_name) return h("a", { href: `/api/documents/${d.id}/file`, target: "_blank", rel: "noopener" }, text);
  if (d.drive_url) return h("a", { href: d.drive_url, target: "_blank", rel: "noopener" }, text, " ↗");
  return document.createTextNode(text);
}

function uploadForm(): HTMLElement {
  const file = h("input", { type: "file", multiple: "", class: "fn-input" });
  const type = h("input", { class: "fn-input", placeholder: "Type (statement, bill, W-2…)" });
  const issuer = h("input", { class: "fn-input", placeholder: "From (bank, employer…)" });
  const date = h("input", { type: "date", class: "fn-input" });
  date.value = todayIso();
  const desc = h("input", { class: "fn-input", placeholder: "Description" });
  const amount = h("input", { class: "fn-input", inputmode: "decimal", placeholder: "Amount (optional)" });
  const hint = h("span", {}, "Drop statements, bills or forms here, or choose files");
  const drop = h("div", { class: "fn-drop" }, icon("upload", 22), hint, file);

  const picked = () => Array.from(file.files ?? []);
  const pickFiles = () => {
    const fs = picked();
    if (!fs.length) return;
    if (fs.length === 1 && !desc.value) desc.value = baseName(fs[0]);
    hint.textContent = fs.length === 1 ? fs[0].name : `${fs.length} files: ${fs.map((f) => f.name).join(", ")}`;
  };
  file.addEventListener("change", pickFiles);
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("fn-drop-on"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("fn-drop-on"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("fn-drop-on");
    if (e.dataTransfer?.files.length) { file.files = e.dataTransfer.files; pickFiles(); }
  });

  const save = button({
    label: "Add to catalog", variant: "primary",
    onClick: async () => {
      const fs = picked();
      if (!fs.length && !desc.value.trim()) return alert("Choose a file or write a description.");
      // Several files: one catalog row each, named after the file; the shared fields apply to all.
      const one = fs.length <= 1;
      try {
        for (const f of fs.length ? fs : [undefined]) {
          const { id } = await send<{ id: number }>("POST", "/api/documents", {
            type: type.value.trim() || null, issuer: issuer.value.trim() || null, doc_date: date.value || null,
            description: (one && desc.value.trim()) || (f ? baseName(f) : null),
            amount: one ? parseMoney(amount.value.trim()) : null,
          });
          if (f) await api.uploadFile(id, f);
        }
      } catch (e) { alert((e as Error).message); }
    },
  });
  return section("Add a document", drop, h("div", { class: "fn-form-grid" }, type, issuer, date, desc, amount), save);
}
