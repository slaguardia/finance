# finance: a self-hosted money dashboard you build up by feeding it documents

A small personal finance app for one person on their own server. Hand it a bank
statement, a loan statement, a pay stub, a bill or a tax form, and an agent
(Claude Code, in practice) reads it, files it in the document catalog, and
updates the numbers it touches. The dashboard redraws as each change lands.
You can also click any figure and edit it yourself.

It replaces a budgeting spreadsheet. You import the sheet once, then this
database is the record.

## What you can feed it

| Send it | It files the document and updates |
|---|---|
| Bank or brokerage statement (checking, savings, HYSA, brokerage, 401k, HSA) | that account's balance on the statement date |
| Credit card statement | the card balance, plus any new recurring merchants it spots in the transactions |
| Loan statement (student loans, auto, mortgage) | each loan's balance and rate on that date, which feeds the debt payoff chart |
| Pay stub or offer letter | take-home income (weekly, monthly or yearly) |
| Bill, receipt, renewal or "your subscription" email | recurring payments: amount, how often, due day |
| Insurance declaration or policy letter | the premium as a recurring payment; cash value, if any, as an account |
| Tax form (W-2, 1099, 1098-E, 1095-C, 1099-SA…) | the catalog, with the key amounts recorded |
| Screenshot of a balance, or a CSV export | whatever balances or transactions it shows |
| A spreadsheet you already keep | everything, through one bulk `POST /api/import` |

Every document gets a catalog row recording what it changed, and the file itself
is stored and backed up. Every change goes in an activity log.

## What it shows

- **Overview:** a greeting, net worth and its change, debt left, take-home, fixed bills and
  what's left after them. A take-home split bar, debt payoff progress per lender,
  charts for net worth and card balances,
  plus a "needs updating" list (accounts not logged recently, bills missing an
  amount or due date) and what's due in the next two weeks.
- **Accounts:** every account by type with its latest balance, a form to log a
  set of month-end balances, and a history chart and table for each account.
- **Budget:** income and recurring payments, all editable in place.
- **Debt:** each loan's balance, rate and status, the payoff chart, and the
  interest accruing each month.
- **Documents:** the catalog, with drag-and-drop upload.
- **Log:** every change, plus the nightly backups and a "back up now" button.

Net worth is fresh asset balances minus fresh card balances. A balance older
than `STALE_DAYS` (92 by default) stops counting and shows up as a gap, rather
than quietly carrying an old number forward. Loans are tracked separately as
debt.

## How it's built

- **Backend** (`backend/`): Node + TypeScript + Express, with SQLite through
  `better-sqlite3`. It serves JSON at `/api/*` and the built PWA at `/`. Every
  write appends to the activity log and emits a `changed` event on
  `/api/events` (SSE), which open pages listen to.
- **PWA** (`web/`): vanilla TypeScript + Vite, built on
  [`@brainbot/web-toolkit`](https://github.com/slaguardia/brainbot/tree/master/web-toolkit)
  (design tokens, app shell, service worker). The charts are hand-rolled SVG,
  with no chart or UI framework.
- **Storage:** `/data/finance.db` and `/data/files/<sha256><ext>`. Stored files
  are content-addressed, so the same document uploaded twice is stored once.
- **Backups:** each night (after `BACKUP_HOUR`) it writes a consistent snapshot
  to `BACKUP_DIR/finance-YYYY-MM-DD.db` using SQLite's online backup API, copies
  stored files to `BACKUP_DIR/files/`, and keeps the newest `BACKUP_KEEP` (30)
  snapshots.
- **Auth:** none in the app, by design. It's meant to sit behind an auth edge
  (here, Caddy `forward_auth` to oauth2-proxy with Google sign-in and an email
  allowlist). `/api/me` echoes the edge's `X-Auth-Request-Email`.
  **Don't expose it to the internet without that.**

## Data model

| Table | Holds |
|---|---|
| `accounts` | id (slug), name, kind (`cash` `investment` `retirement` `insurance` `card` `loan`), institution, last 4, closed |
| `balances` | account, as-of date, balance, rate (APR %), source document |
| `period_notes` | a note for a date ("holiday travel"), shown with that date's balances |
| `recurring` | name, `monthly`/`annually`, amount, due day (and month for yearly items), category, active |
| `income` | label, amount, per `week`/`month`/`year` |
| `documents` | dates, type, issuer, description, amount, what it was applied to, notes, stored file or external link |
| `activity` | timestamped one-line summary of every change |

## API

Everything the UI does goes through these, so an agent can do the same.

```
GET    /api/overview                     tiles, series, gaps, due soon, recent activity
GET    /api/accounts | /api/accounts/:id
POST   /api/accounts                     {id, name, kind, institution?, last4?}
PATCH  /api/accounts/:id
PUT    /api/balances                     {account_id, as_of, balance, rate?, document_id?}  or  {balances: [...]}
DELETE /api/balances/:account/:as_of
GET    /api/balances?kind=card           every balance joined with its account
PUT    /api/notes/:as_of                 {note}  ("" removes it)
GET    /api/recurring | POST | PATCH /:id | DELETE /:id
GET    /api/income    | POST | PATCH /:id | DELETE /:id
GET    /api/documents | POST {…metadata} | PATCH /:id | DELETE /:id
PUT    /api/documents/:id/file           raw body, Content-Type + X-Filename headers
GET    /api/documents/:id/file
POST   /api/import                       {accounts, balances, notes, recurring, income, documents, source?}
GET    /api/backups | POST /api/backups
GET    /api/activity | /api/events (SSE) | /api/me | /healthz
```

`scripts/fin` calls the API from the host over the Docker network:

```bash
scripts/fin GET /api/overview
scripts/fin PUT /api/balances '{"account_id":"checking","as_of":"2026-10-31","balance":4210.55}'
scripts/fin POST /api/documents '{"type":"Statement","issuer":"Example Bank","doc_date":"2026-10-31"}'
scripts/fin upload 12 ~/statement.pdf
```

## Running it

```bash
# backend (dev): data/ and backups/ land next to it
cd backend && npm install && npm run dev            # :8789

# PWA: built into web/dist (committed; the image bakes it in)
scripts/build-web.sh                                # needs Docker; expects ../brainbot next to this repo

# image
docker build -f backend/Dockerfile -t finance .
docker run -v finance-data:/data -v "$PWD/backups:/backups" -e TZ=America/New_York finance
```

Environment variables: `PORT` (8789), `DATA_DIR`, `BACKUP_DIR`, `BACKUP_HOUR`
(4), `BACKUP_KEEP` (30), `STALE_DAYS` (92), `TZ` (used for "today" and backup
times).

Your data never goes in the repo. `data/`, `backups/`, `*.db` and `seed*.json`
are all gitignored.

## Working on it with Claude Code

[`CLAUDE.md`](CLAUDE.md) tells an agent how to file a document, how to change
the dashboard, and how to ship a change. The idea is that you keep telling it
what you want to see, and it keeps building.

## License

MIT
