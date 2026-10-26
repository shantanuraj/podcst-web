CREATE TABLE review_accounts (
  store TEXT PRIMARY KEY CHECK (store IN ('apple', 'google')),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code_digest TEXT NOT NULL CHECK (code_digest ~ '^[a-f0-9]{64}$'),
  operation_id UUID NOT NULL UNIQUE,
  operation_digest TEXT NOT NULL CHECK (operation_digest ~ '^[a-f0-9]{64}$'),
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('create', 'reset', 'rotate')),
  seed_revision TEXT,
  seed_digest TEXT CHECK (seed_digest ~ '^[a-f0-9]{64}$'),
  submission TEXT NOT NULL CHECK (char_length(submission) BETWEEN 1 AND 200),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((seed_revision IS NULL) = (seed_digest IS NULL)),
  CHECK (operation_kind <> 'reset' OR seed_digest IS NOT NULL)
);
