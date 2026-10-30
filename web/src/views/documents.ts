import type { View } from "@brainbot/web-toolkit/shell";
import { button, table } from "@brainbot/web-toolkit/components";
import { api, send, type Account, type Doc } from "../api";
import { day, h, lastMonths, month, rate, shortMonth, todayIso, usd2 } from "../fmt";
import { editable, parseMoney } from "../edit";
import { pageHead, removeBtn, scrolledToEnd, section, withTip } from "../ui";
import { icon } from "../icons";
import { isDone, KIND_ICON, KIND_TONE } from "./accounts";

export const DocumentsView = (): View => ({
  async mount(el) {
    const [docs, accounts] = await Promise.all([api.documents(), api.accounts()]);
    el.replaceChildren(
      pageHead("Documents", "Every statement, bill and form, with what it changed. Drop files here, then ask Claude to file them."),
      statementGrid(docs.filter(isStatement), accounts),
      ...taxForms(docs),
      uploadForm(),
      section(`Catalog (${docs.length})`, table({
        columns: ["Date", "Type", "From", "Description", "Amount", "Applied to", "Notes", ""],
        rows: docs.map((d) => [
          h("span", { class: "fn-nowrap" }, day(d.doc_date ?? d.added_at)),
          editable({ value: d.type ?? "", display: d.type || "—", save: (v) => patch(d, { type: v }) }),
          editable({ value: d.issuer ?? "", display: d.issuer || "—", save: (v) => patch(d, { issuer: v }) }),
          h("span", { class: "fn-desc" }, link(d)),
          editable({ value: d.amount, display: d.amount == null ? "—" : usd2(d.amount), type: "money", save: (v) => patch(d, { amount: parseMoney(v) }) }),
          d.applied_to ? clamp(d.applied_to) : h("span", { class: "fn-pill fn-pill-maybe fn-pill-sm" }, "Not filed yet"),
          clamp(editable({ value: d.notes ?? "", display: d.notes || "—", save: (v) => patch(d, { notes: v }) }), d.notes ?? ""),
          removeBtn(`document #${d.id} from the catalog`, () => send("DELETE", `/api/documents/${d.id}`)),
        ]),
        sortable: true,
      })),
    );
  },
});

/** Long text cut to three lines; hovering shows all of it (an editable cell opens the full text on click). */
function clamp(content: string | HTMLElement, full = typeof content === "string" ? content : ""): HTMLElement {
  const box = typeof content === "string" ? h("span", { tabindex: "0" }, content) : content;
  box.classList.add("fn-clamp3");
  return full.length > 140 ? withTip(box, () => [h("p", { class: "fn-tip-full" }, full)], box, false) : box;
}

const isStatement = (d: Doc) => /statement/i.test(d.type ?? "");
const isTaxForm = (d: Doc) => /\b(W-2|1099|1098|1095|5498)\b|tax form/i.test(d.type ?? "");
/** The year a form reports on: the description's leading year ("2025 W-2: …"), else the year before it was issued. */
const taxYear = (d: Doc) => (d.description ?? "").match(/^(\d{4})\b/)?.[1] ?? String(Number((d.doc_date ?? d.added_at).slice(0, 4)) - 1);
const monthOf = (d: Doc) => (d.doc_date ?? d.added_at).slice(0, 7);

/**
 * One row per institution with open accounts, one column per month for the last year. A statement belongs to the
 * account whose balance it set; one that set none (a second checking account, a term policy) goes to the row
 * whose institution matches its issuer.
 */
function statementGrid(docs: Doc[], accounts: Account[]): HTMLElement {
  const months = lastMonths(12);
  const key = (a: Account) => a.institution || a.name;
  const rows = new Map<string, { accounts: Account[]; docs: Doc[] }>();
  for (const a of accounts.filter((a) => !isDone(a))) {
    if (!rows.has(key(a))) rows.set(key(a), { accounts: [], docs: [] });
    rows.get(key(a))!.accounts.push(a);
  }
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const other: Doc[] = [];
  for (const d of docs) {
    const linked = (d.account_ids ?? "").split(",").map((id) => byId.get(id)).find((a) => a && rows.has(key(a)));
    const issuer = (d.issuer ?? "").toLowerCase();
    const k = linked ? key(linked) : [...rows.keys()].find((k) => issuer && (issuer.startsWith(k.toLowerCase()) || k.toLowerCase().startsWith(issuer)));
    (k ? rows.get(k)!.docs : other).push(d);
  }

  const cells = (row: string, ds: Doc[]) => months.map((m) => {
    const here = ds.filter((d) => monthOf(d) === m);
    return h("td", {}, ...(here.length ? here.map((d) => withTip(d.file_name
      ? h("a", { class: "fn-stmt", href: `/api/documents/${d.id}/file`, target: "_blank", rel: "noopener", "aria-label": label(d) }, icon("file", 15))
      : h("span", { class: "fn-stmt fn-stmt-nofile", tabindex: "0", "aria-label": label(d) }, icon("file", 15)),
      (touch) => stmtTip(d, byId, touch)))
      : [withTip(h("span", { class: "fn-stmt-none" }, "·"), () => [h("strong", {}, `Nothing for ${month(m)}`), h("div", { class: "fn-tip-sub" }, row)])]));
  });
  const perMonth = (m: string) => docs.filter((d) => monthOf(d) === m).length;
  const head = h("tr", {}, h("th", {}, "Account"), ...months.map((m) => withTip(h("th", { tabindex: "0" }, shortMonth(m)), () => [
    h("strong", {}, month(m)), h("div", { class: "fn-tip-sub" }, `${perMonth(m) || "No"} statement${perMonth(m) === 1 ? "" : "s"} on file`)])));
  const body = [...rows].map(([k, r]) => {
    const kind = r.accounts[0].kind;
    const names = r.accounts.map((a) => a.name).filter((n) => n !== k);
    return h("tr", { class: `fn-tone-${KIND_TONE[kind]}` },
      h("td", {}, withTip(h("div", { class: "fn-srow", tabindex: "0" }, h("span", { class: "fn-chip" }, icon(KIND_ICON[kind], 16)),
        h("div", {}, k, names.length ? h("small", {}, names.length > 2 ? `${names.length} accounts` : names.join(", ")) : null)),
        () => rowTip(r.accounts, r.docs.filter((d) => monthOf(d) >= months[0]).length))),
      ...cells(k, r.docs));
  });
  if (other.length) body.push(h("tr", { class: "fn-tone-link" },
    h("td", {}, h("div", { class: "fn-srow" }, h("span", { class: "fn-chip" }, icon("file", 16)), h("div", {}, "Other statements"))),
    ...cells("Statements that don't match an account above", other)));

  return section("Statements by month",
    h("p", { class: "fn-muted fn-note" }, "Each icon is a statement on file. Hover or tap one for what it is and what it updated; click to open it. A dot means nothing on file for that month."),
    scrolledToEnd(h("div", { class: "fn-scroll" }, h("table", { class: "fn-sgrid" }, h("thead", {}, head), h("tbody", {}, ...body)))),
    exportForm(docs));
}

const label = (d: Doc) => `${day(d.doc_date ?? d.added_at)} · ${d.description ?? d.type ?? "Statement"}`;

/** What a statement is, the account(s) it updated, and what filing it changed. */
function stmtTip(d: Doc, byId: Map<string, Account>, touch: boolean): Node[] {
  const updated = (d.account_ids ?? "").split(",").map((id) => byId.get(id)?.name).filter(Boolean).join(", ");
  const facts: [string, string][] = [];
  if (d.issuer) facts.push(["From", d.issuer]);
  if (d.amount != null) facts.push(["Amount", usd2(d.amount)]);
  if (updated) facts.push(["Updated", updated]);
  return [
    h("strong", {}, d.description ?? d.type ?? "Statement"),
    h("div", { class: "fn-tip-sub" }, [day(d.doc_date ?? d.added_at), d.type].filter(Boolean).join(" · ")),
    facts.length ? h("dl", {}, ...facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])) : null,
    d.applied_to ? h("p", { class: "fn-tip-note" }, d.applied_to) : null,
    !d.file_name ? h("div", { class: "fn-tip-foot fn-tip-warn" }, "Catalog entry only: no file stored")
      : touch ? null : h("div", { class: "fn-tip-foot" }, "Click to open the file"),
  ].filter((n): n is HTMLElement => n !== null);
}

/** The accounts behind a grid row: number, latest balance, rate, and whether a statement is overdue. */
function rowTip(accounts: Account[], filed: number): Node[] {
  return [
    ...accounts.map((a) => h("div", { class: "fn-tip-acct" },
      h("strong", {}, a.name),
      h("div", { class: "fn-tip-sub" }, [a.institution, a.last4 && `•••• ${a.last4}`, a.kind].filter(Boolean).join(" · ")),
      h("dl", {},
        h("dt", {}, "Balance"), h("dd", {}, a.balance == null ? "None logged" : `${usd2(a.balance)} on ${day(a.as_of)}`),
        ...(a.rate != null ? [h("dt", {}, "Rate"), h("dd", {}, rate(a.rate))] : [])),
      a.overdue ? h("div", { class: "fn-tip-foot fn-tip-warn" }, "Needs a newer statement") : null)),
    h("div", { class: "fn-tip-foot" }, `${filed || "No"} statement${filed === 1 ? "" : "s"} on file in the last 12 months`),
  ];
}

/** W-2s, 1099s, 1098s and the like, newest tax year first, each one click from its PDF. Hover a row for its box details. */
function taxForms(docs: Doc[]): HTMLElement[] {
  const forms = docs.filter(isTaxForm)
    .sort((a, b) => taxYear(b).localeCompare(taxYear(a)) || (a.type ?? "").localeCompare(b.type ?? ""));
  if (!forms.length) return [];
  const what = (d: Doc) => { const t = (d.description ?? d.type ?? "Tax form").replace(/^\d{4}\s+[^:]*:\s*/, ""); return t[0].toUpperCase() + t.slice(1); };
  const detail = (d: Doc) => () => [h("strong", {}, `${taxYear(d)} ${d.type ?? "Tax form"} · ${d.issuer ?? ""}`),
    h("div", { class: "fn-tip-sub" }, `Issued ${day(d.doc_date ?? d.added_at)}`),
    d.notes ? h("p", { class: "fn-tip-note fn-tip-full" }, d.notes) : null];
  const card = section(h("span", {}, icon("file", 16), ` Tax forms (${forms.length})`), table({
    columns: ["Tax year", "Form", "From", "What it shows", "Amount", ""],
    rows: forms.map((d) => [
      taxYear(d),
      h("span", { class: "fn-pill fn-pill-sm fn-pill-form" }, d.type ?? "Form"),
      d.issuer ?? "—",
      h("div", {}, h("span", { class: "fn-pill fn-pill-sm fn-pill-form fn-phone-only" }, d.type ?? "Form"),
        withTip(h("span", { class: "fn-taxwhat", tabindex: "0" }, what(d)), detail(d))),
      d.amount == null ? "—" : usd2(d.amount),
      d.file_name
        ? h("a", { class: "tk-btn fn-open", href: `/api/documents/${d.id}/file`, target: "_blank", rel: "noopener" }, icon("file", 14), h("span", {}, "Open"))
        : h("span", { class: "fn-muted" }, "No file"),
    ]),
  }));
  card.classList.add("fn-taxforms");
  return [card];
}

/** Download every stored statement since the start of a recent month, as one zip. */
function exportForm(docs: Doc[]): HTMLElement {
  const starts = [1, 2, 5, 11].map((back) => lastMonths(back + 1)[0] + "-01");
  const count = (since: string) => docs.filter((d) => d.file_name && (d.doc_date ?? d.added_at) >= since).length;
  const pickSince = h("select", { class: "fn-input" }, ...starts.map((s, i) =>
    h("option", { value: s, ...(i === 1 ? { selected: "" } : {}) }, `Since ${day(s)} (${count(s)} statements)`)));
  const go = button({ label: "Download zip", variant: "primary", onClick: () => {
    if (!count(pickSince.value)) return alert("No stored statements in that range yet.");
    location.href = `/api/documents/export?since=${pickSince.value}`;
  } });
  return h("div", { class: "fn-export" }, icon("download", 18), h("span", {}, "Export statements"), pickSince, go);
}

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
