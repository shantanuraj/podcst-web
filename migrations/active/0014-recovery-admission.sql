CREATE TABLE recovery_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  run_id UUID NOT NULL,
  incarnation UUID NOT NULL,
  journal_id UUID NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence >= 0),
  hash TEXT NOT NULL CHECK (hash ~ '^[a-f0-9]{64}$'),
  artifact_hash TEXT CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  auth_epoch UUID,
  generation UUID,
  CHECK ((auth_epoch IS NULL) = (generation IS NULL))
);

REVOKE ALL ON recovery_state FROM PUBLIC;
