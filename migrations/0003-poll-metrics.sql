ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS feed_etag TEXT;
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS feed_last_modified TEXT;
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS feed_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_podcasts_last_published
  ON podcasts(last_published DESC NULLS LAST)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS poll_metrics (
  id SERIAL PRIMARY KEY,
  metric_name TEXT NOT NULL,
  metric_value INTEGER NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poll_metrics_name_time
  ON poll_metrics(metric_name, recorded_at DESC);
