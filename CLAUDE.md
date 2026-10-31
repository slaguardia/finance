# finance — working notes for agents

Personal finance app: SQLite record + document catalog + dashboard PWA. Read
[README.md](README.md) for the shape. This repo is **public**: never commit real
financial data, account numbers, names, imports or screenshots. Real data lives
only in the running container's `/data` volume and its backups.

## Filing a document the owner sends

1. Read it fully. Pull out issuer, type, document date, period, the amounts that
   matter, due dates, and account **last 4 only**.
2. `scripts/fin POST /api/documents '{type, issuer, doc_date, description, amount?, notes?}'`
   then `scripts/fin upload <id> <file>` to store the file.
3. Apply it: `PUT /api/balances` (with `document_id`), `POST`/`PATCH /api/recurring`,
   `PATCH /api/income/:id`, or create the account first if it's new. A statement
   that splits the balance (401(k) sources, funds) → `PUT /api/breakdowns`.
   If a value conflicts with what's stored, say what's there vs the document and
   use the document's figure unless it's clearly older.
4. `PATCH /api/documents/:id '{"applied_to": "..."}'` describing exactly what changed.
5. Report in a few lines: what it was, which values changed, anything needing
   attention (a due date, a price increase, an odd charge).

Files the owner uploaded through the Documents page arrive as catalog rows with
an empty `applied_to` (shown as "Not filed yet"). To file them, fetch each with
`GET /api/documents/:id/file`, then do steps 1 and 3–5 on that row (fill in
type, issuer and doc_date with `PATCH`).

`GET /api/overview` → `gaps` is the check-in list.

## The Claude connector and the backlog

`/mcp` (`backend/src/mcp.ts`) lets a Claude chat with an access key read the
record and make safe edits; it calls this app's own `/api`, so edits get the
same checks and are logged "(via Claude)". Keep it that way: no delete tools,
no documents. Keys live hashed in `DATA_DIR/access-keys.json` (`keys.ts`); the
backlog of app ideas in `DATA_DIR/backlog.json` (`backlog.ts`). When asked
"what's on the backlog", `GET /api/backlog`; mark an item done with
`PATCH /api/backlog/:id '{"status":"done"}'` once it ships.

## Changing the app

- Backend: `backend/src/` — `server.ts` (routes), `calc.ts` (every derived
  number; keep math here, not in the PWA), `backup.ts`, `store.ts`. Schema
  changes are a new numbered file in `backend/migrations/` (never edit an
  applied one).
- PWA: `web/src/views/*.ts`, one per nav page; `edit.ts` (click-to-edit),
  `chart.ts` (SVG charts), `ui.ts`, `fmt.ts`. Theme only through the toolkit's
  CSS variables. No UI/chart frameworks.
- Live refresh is automatic: any API write emits `changed`, and the open page
  re-renders the current view.

## Verify, then ship

```bash
(cd backend && npx tsc --noEmit) && (cd web && npx tsc --noEmit)
scripts/build-web.sh                      # rebuilds web/dist — commit it
```

Smoke-test the API against a scratch data dir (`DATA_DIR=… BACKUP_DIR=… PORT=… npx tsx src/index.ts`)
before deploying. On the owner's VPS the service is `finance` in the shared
compose stack; redeploy with
`docker compose -f ../brainbot/compose/docker-compose.yml up -d --build finance`
and check `docker logs finance`. A migration touches the live record: take
`POST /api/backups` first.
