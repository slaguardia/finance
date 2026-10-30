-- Recurring payments can repeat weekly, every two weeks, monthly, quarterly,
-- every six months or yearly. SQLite can't change a CHECK constraint, so the
-- table is rebuilt with the same ids.
--   weekly / biweekly           → start_date: any one date it was (or will be) paid
--   monthly                     → due_day
--   quarterly / semiannually /  → due_day + due_month: any one month it falls in
--   annually
CREATE TABLE recurring_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  frequency  TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','semiannually','annually')),
  amount     REAL,                             -- null = amount unknown
  due_day    INTEGER CHECK (due_day BETWEEN 1 AND 31),
  due_month  INTEGER CHECK (due_month BETWEEN 1 AND 12),
  start_date TEXT,                             -- YYYY-MM-DD, weekly and biweekly only
  category   TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  notes      TEXT
);
INSERT INTO recurring_new (id, name, frequency, amount, due_day, due_month, category, active, notes)
  SELECT id, name, frequency, amount, due_day, due_month, category, active, notes FROM recurring;
DROP TABLE recurring;
ALTER TABLE recurring_new RENAME TO recurring;
