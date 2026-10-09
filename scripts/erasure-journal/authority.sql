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

REVOKE ALL ON SCHEMA erasure_authority FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA erasure_authority FROM PUBLIC;
