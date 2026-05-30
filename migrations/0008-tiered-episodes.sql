-- migrations/0008-tiered-episodes.sql
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz;
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS is_essential boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_podcasts_last_accessed ON podcasts(last_accessed_at);
CREATE INDEX IF NOT EXISTS idx_podcasts_is_essential ON podcasts(is_essential) WHERE is_essential;

CREATE TABLE IF NOT EXISTS episode_content (
  episode_id  bigint PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  title       text NOT NULL,
  summary     text,
  duration    integer,
  episode_art text,
  file_url    text NOT NULL,
  file_length bigint,
  file_type   text
);
