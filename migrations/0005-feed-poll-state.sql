BEGIN;

CREATE TABLE feed_poll_state (
  podcast_id INTEGER PRIMARY KEY REFERENCES podcasts(id) ON DELETE CASCADE,
  etag TEXT,
  last_modified TEXT,
  hash TEXT,
  last_polled_at TIMESTAMPTZ,
  next_poll_at TIMESTAMPTZ DEFAULT now(),
  failures INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_feed_poll_state_due
  ON feed_poll_state(next_poll_at ASC NULLS FIRST)
  WHERE failures < 5;

INSERT INTO feed_poll_state (podcast_id, etag, last_modified, hash, last_polled_at, next_poll_at, failures)
SELECT
  id,
  feed_etag,
  feed_last_modified,
  feed_hash,
  last_polled_at,
  next_poll_at,
  COALESCE(poll_failures, 0)
FROM podcasts;

DROP INDEX IF EXISTS idx_podcasts_next_poll;

ALTER TABLE podcasts DROP COLUMN feed_etag;
ALTER TABLE podcasts DROP COLUMN feed_last_modified;
ALTER TABLE podcasts DROP COLUMN feed_hash;
ALTER TABLE podcasts DROP COLUMN last_polled_at;
ALTER TABLE podcasts DROP COLUMN next_poll_at;
ALTER TABLE podcasts DROP COLUMN poll_failures;

COMMIT;
