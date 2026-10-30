-- How an account's balance splits on a date, in named groups: a 401(k) by tax
-- treatment (Roth / pre-tax), by who put the money in, by fund. Each group's
-- rows add up to that date's balance.
CREATE TABLE breakdowns (
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  as_of       TEXT NOT NULL,                   -- YYYY-MM-DD
  grp         TEXT NOT NULL,                   -- "Tax treatment", "Who put it in", "Invested in"
  label       TEXT NOT NULL,
  amount      REAL NOT NULL,
  detail      TEXT,                            -- e.g. "Roth $32,788.43 + converted $6,629.30"
  sort        INTEGER NOT NULL DEFAULT 0,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  PRIMARY KEY (account_id, as_of, grp, label)
);
