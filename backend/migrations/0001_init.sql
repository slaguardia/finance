-- finance working set. This database is the record; a spreadsheet or any other
-- source is brought in once through POST /api/import and then left as an archive.

-- Every place money sits or is owed. Net worth = assets − cards; loans are
-- tracked as debt and shown separately.
CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,                -- slug, e.g. 'checking', 'student-loan-1'
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('cash','investment','retirement','insurance','card','loan')),
  institution TEXT,                            -- groups loans by lender, cards by issuer
  last4       TEXT,                            -- never a full account number
  sort        INTEGER NOT NULL DEFAULT 0,
  closed      INTEGER NOT NULL DEFAULT 0,
  notes       TEXT
);

-- Point-in-time balances. One row per account per date; rate is APR % (loans, cards).
CREATE TABLE balances (
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  as_of       TEXT NOT NULL,                   -- YYYY-MM-DD
  balance     REAL NOT NULL,
  rate        REAL,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  PRIMARY KEY (account_id, as_of)
);

-- Free-text context for a date ("Europe trip"), shown with that period's balances.
CREATE TABLE period_notes (
  as_of TEXT PRIMARY KEY,
  note  TEXT NOT NULL
);

CREATE TABLE recurring (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  frequency  TEXT NOT NULL CHECK (frequency IN ('monthly','annually')),
  amount     REAL,                             -- null = amount unknown
  due_day    INTEGER CHECK (due_day BETWEEN 1 AND 31),
  due_month  INTEGER CHECK (due_month BETWEEN 1 AND 12),  -- annual items only
  category   TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  notes      TEXT
);

CREATE TABLE income (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  label  TEXT NOT NULL,
  amount REAL NOT NULL,
  per    TEXT NOT NULL CHECK (per IN ('week','month','year'))
);

-- The document catalog. A file, when stored here, lives at /data/files/<sha256><ext>.
CREATE TABLE documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  added_at    TEXT NOT NULL DEFAULT (date('now')),
  doc_date    TEXT,
  type        TEXT,
  issuer      TEXT,
  description TEXT,
  amount      REAL,
  applied_to  TEXT,                            -- what this document changed, in words
  notes       TEXT,
  drive_url   TEXT,
  file_name   TEXT,
  file_sha    TEXT,
  file_ext    TEXT,
  mime        TEXT,
  size        INTEGER
);

-- What changed and when, newest first in the UI.
CREATE TABLE activity (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  summary TEXT NOT NULL
);
