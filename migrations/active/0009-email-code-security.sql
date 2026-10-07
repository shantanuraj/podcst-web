DELETE FROM email_verifications;

ALTER TABLE email_verifications
  DROP COLUMN code,
  ADD COLUMN code_digest TEXT NOT NULL CHECK (code_digest ~ '^[a-f0-9]{64}$'),
  ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  ADD COLUMN ready BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT email_verifications_email_key UNIQUE (email);

DROP INDEX idx_email_verifications_email;
