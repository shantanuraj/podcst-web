ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ;
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS next_poll_at TIMESTAMPTZ;
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS poll_failures INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_podcasts_next_poll
  ON podcasts(next_poll_at ASC NULLS FIRST)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_podcasts_poll_priority
  ON podcasts(priority DESC NULLS LAST, popularity_score DESC NULLS LAST)
  WHERE is_active = true;
