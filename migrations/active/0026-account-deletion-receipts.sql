CREATE TABLE account_deletion_receipts (
  digest TEXT PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  operation_id UUID NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX account_deletion_receipts_expiry ON account_deletion_receipts(expires_at);
