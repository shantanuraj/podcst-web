CREATE TABLE account_erasure_proofs (
  operation_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  code_digest TEXT NOT NULL CHECK (code_digest ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  receipt_expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  ready BOOLEAN NOT NULL DEFAULT false,
  CHECK (receipt_expires_at > expires_at)
);

CREATE INDEX account_erasure_proofs_user ON account_erasure_proofs(user_id);
CREATE INDEX account_erasure_proofs_expiry ON account_erasure_proofs(expires_at);

CREATE TABLE account_erasure_intents (
  operation_id UUID PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('erase_account', 'revoke_passkey')),
  account_id TEXT NOT NULL,
  credential_id TEXT,
  accepted_at TIMESTAMPTZ NOT NULL,
  receipt_expires_at TIMESTAMPTZ NOT NULL,
  publication JSONB,
  applied_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claim_token UUID,
  claim_expires_at TIMESTAMPTZ,
  CHECK ((action = 'erase_account') = (credential_id IS NULL)),
  CHECK (receipt_expires_at > accepted_at),
  CHECK (publication IS NULL OR jsonb_typeof(publication) = 'object'),
  CHECK (applied_at IS NULL OR publication IS NOT NULL),
  CHECK ((claim_token IS NULL) = (claim_expires_at IS NULL))
);

CREATE UNIQUE INDEX account_erasure_one_account ON account_erasure_intents(account_id) WHERE action = 'erase_account';
CREATE UNIQUE INDEX account_erasure_one_passkey ON account_erasure_intents(credential_id) WHERE action = 'revoke_passkey';
CREATE INDEX account_erasure_pending ON account_erasure_intents(next_attempt_at, accepted_at) WHERE applied_at IS NULL;

CREATE FUNCTION guard_erasure_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.operation_id, OLD.action, OLD.account_id, OLD.credential_id, OLD.accepted_at, OLD.receipt_expires_at)
    IS DISTINCT FROM ROW(NEW.operation_id, NEW.action, NEW.account_id, NEW.credential_id, NEW.accepted_at, NEW.receipt_expires_at)
    OR (OLD.publication IS NOT NULL AND OLD.publication IS DISTINCT FROM NEW.publication)
    OR (OLD.applied_at IS NOT NULL AND OLD.applied_at IS DISTINCT FROM NEW.applied_at) THEN
    RAISE EXCEPTION 'Erasure identity is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER account_erasure_identity BEFORE UPDATE ON account_erasure_intents
FOR EACH ROW EXECUTE FUNCTION guard_erasure_identity();
