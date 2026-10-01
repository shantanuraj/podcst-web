ALTER TABLE podcasts
  ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  ADD CONSTRAINT podcasts_private_provider_check
    CHECK (owner_user_id IS NULL OR itunes_id IS NULL);

CREATE INDEX idx_podcasts_owner ON podcasts(owner_user_id)
  WHERE owner_user_id IS NOT NULL;
