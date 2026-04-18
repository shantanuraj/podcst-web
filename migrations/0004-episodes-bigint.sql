BEGIN;

ALTER TABLE playback_progress DROP CONSTRAINT IF EXISTS playback_progress_episode_id_fkey;
ALTER TABLE transcripts DROP CONSTRAINT IF EXISTS transcripts_episode_id_fkey;

DROP TABLE IF EXISTS episodes;

CREATE TABLE episodes (
  id BIGSERIAL PRIMARY KEY,
  podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  published TIMESTAMPTZ NOT NULL,
  duration INTEGER,
  episode_art TEXT,
  file_url TEXT NOT NULL,
  file_length BIGINT,
  file_type TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (podcast_id, guid)
);

CREATE INDEX idx_episodes_podcast ON episodes(podcast_id);
CREATE INDEX idx_episodes_published ON episodes(published DESC);

TRUNCATE playback_progress;
ALTER TABLE playback_progress ALTER COLUMN episode_id TYPE bigint;

TRUNCATE transcripts;
ALTER TABLE transcripts ALTER COLUMN episode_id TYPE bigint;

ALTER TABLE playback_progress
  ADD CONSTRAINT playback_progress_episode_id_fkey
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;

ALTER TABLE transcripts
  ADD CONSTRAINT transcripts_episode_id_fkey
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;

UPDATE podcasts SET
  episode_count = 0,
  last_published = NULL,
  last_polled_at = NULL,
  next_poll_at = NULL,
  feed_etag = NULL,
  feed_last_modified = NULL,
  feed_hash = NULL,
  poll_failures = 0
WHERE is_active = true;

COMMIT;
