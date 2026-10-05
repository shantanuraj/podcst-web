ALTER TABLE passkeys
  ADD COLUMN aaguid UUID,
  ADD COLUMN last_used_at TIMESTAMPTZ;

CREATE TABLE account_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  speed REAL NOT NULL,
  volume_boost BOOLEAN NOT NULL,
  trim_silence BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
