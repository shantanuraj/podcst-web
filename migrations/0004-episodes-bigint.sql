BEGIN;

ALTER SEQUENCE episodes_id_seq AS bigint;

ALTER TABLE episodes
  ALTER COLUMN id TYPE bigint;

ALTER TABLE playback_progress
  ALTER COLUMN episode_id TYPE bigint;

ALTER TABLE transcripts
  ALTER COLUMN episode_id TYPE bigint;

COMMIT;
