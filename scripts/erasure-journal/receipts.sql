CREATE SCHEMA erasure_receipts;

CREATE TABLE erasure_receipts.receipts (
  digest TEXT PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  operation_id UUID NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX erasure_receipts_expiry ON erasure_receipts.receipts (expires_at);

REVOKE ALL ON SCHEMA erasure_receipts FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA erasure_receipts FROM PUBLIC;
