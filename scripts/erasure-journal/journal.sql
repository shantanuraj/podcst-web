CREATE SCHEMA erasure_journal;

CREATE TABLE erasure_journal.head (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  journal_id UUID NOT NULL,
  epoch UUID NOT NULL,
  sequence BIGINT NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= sequence),
  hash TEXT NOT NULL CHECK (hash ~ '^[a-f0-9]{64}$'),
  sealed BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE erasure_journal.epochs (
  epoch UUID PRIMARY KEY
);

CREATE TABLE erasure_journal.entries (
  sequence BIGINT PRIMARY KEY CHECK (sequence > 0),
  operation_id UUID NOT NULL UNIQUE,
  key_id TEXT NOT NULL,
  body BYTEA NOT NULL CHECK (octet_length(body) > 28)
);

REVOKE ALL ON SCHEMA erasure_journal FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA erasure_journal FROM PUBLIC;
