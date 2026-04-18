DROP INDEX IF EXISTS idx_episodes_podcast;

DROP INDEX IF EXISTS idx_episodes_published;

ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_podcast_id_guid_key;

ALTER SEQUENCE episodes_id_seq AS bigint;

ALTER TABLE episodes
  ALTER COLUMN id TYPE bigint;

ALTER TABLE playback_progress
  ALTER COLUMN episode_id TYPE bigint;

ALTER TABLE transcripts
  ALTER COLUMN episode_id TYPE bigint;

ALTER TABLE episodes
  ADD CONSTRAINT episodes_podcast_id_guid_key UNIQUE (podcast_id, guid);

CREATE INDEX idx_episodes_podcast ON episodes(podcast_id);

CREATE INDEX idx_episodes_published ON episodes(published DESC);
