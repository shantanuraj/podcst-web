CREATE SCHEMA erasure_authority;

CREATE TABLE erasure_authority.head (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  journal_id UUID NOT NULL,
  epoch UUID NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence >= 0),
  revision BIGINT NOT NULL CHECK (revision >= sequence),
  hash TEXT NOT NULL CHECK (hash ~ '^[a-f0-9]{64}$'),
  sealed BOOLEAN NOT NULL
);

CREATE TABLE erasure_authority.recovery_runs (
  id UUID PRIMARY KEY,
  plan JSONB NOT NULL,
  runtime_digest TEXT NOT NULL UNIQUE CHECK (runtime_digest ~ '^[a-f0-9]{64}$'),
  runtime_key TEXT NOT NULL,
  runtime_token BYTEA NOT NULL CHECK (octet_length(runtime_token) > 28),
  attestation JSONB,
  admitted BOOLEAN NOT NULL DEFAULT false,
  abandoned BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE erasure_authority.recovery_gate (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  run_id UUID NOT NULL REFERENCES erasure_authority.recovery_runs(id)
);

CREATE TABLE erasure_authority.recovery_artifacts (
  digest TEXT PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  manifest JSONB NOT NULL,
  origin_run UUID NOT NULL REFERENCES erasure_authority.recovery_runs(id),
  eligible BOOLEAN NOT NULL DEFAULT true
);

REVOKE ALL ON SCHEMA erasure_authority FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA erasure_authority FROM PUBLIC;
