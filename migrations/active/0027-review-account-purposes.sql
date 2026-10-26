ALTER TABLE review_accounts
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'review' CHECK (purpose IN ('review', 'e2e'));

ALTER TABLE review_accounts
  ALTER COLUMN purpose DROP DEFAULT,
  DROP CONSTRAINT review_accounts_pkey,
  ADD PRIMARY KEY (store, purpose);
