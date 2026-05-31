\set ON_ERROR_STOP on

CREATE TABLE episodes_identity (
  id bigint NOT NULL,
  podcast_id bigint NOT NULL,
  guid text NOT NULL,
  published timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
INSERT INTO episodes_identity (id, podcast_id, guid, published, created_at)
  SELECT id, podcast_id, guid, published, created_at FROM episodes;

ALTER TABLE episodes_identity OWNER TO podcst_app;
ALTER TABLE episodes_identity ADD PRIMARY KEY (id);
ALTER TABLE episodes_identity ADD CONSTRAINT episodes_identity_podcast_id_guid_key UNIQUE (podcast_id, guid);
CREATE INDEX idx_episodes_identity_podcast ON episodes_identity(podcast_id);
CREATE INDEX idx_episodes_identity_published ON episodes_identity(published DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM episodes o WHERE NOT EXISTS (
               SELECT 1 FROM episodes_identity n WHERE n.id = o.id)) THEN
    RAISE EXCEPTION 'identity parity failed: some episodes.id missing from episodes_identity';
  END IF;
END $$;

BEGIN;
  ALTER TABLE playback_progress DROP CONSTRAINT playback_progress_episode_id_fkey;
  ALTER TABLE transcripts DROP CONSTRAINT transcripts_episode_id_fkey;
  ALTER TABLE episode_content DROP CONSTRAINT IF EXISTS episode_content_episode_id_fkey;
  ALTER TABLE episodes RENAME TO episodes_old;
  ALTER TABLE episodes_identity RENAME TO episodes;
  ALTER SEQUENCE episodes_id_seq OWNED BY episodes.id;
  ALTER TABLE episodes ALTER COLUMN id SET DEFAULT nextval('episodes_id_seq');
  SELECT setval('episodes_id_seq', (SELECT max(id) FROM episodes));
  ALTER TABLE episodes ADD CONSTRAINT episodes_podcast_id_fkey
    FOREIGN KEY (podcast_id) REFERENCES podcasts(id) ON DELETE CASCADE NOT VALID;
  ALTER TABLE playback_progress ADD CONSTRAINT playback_progress_episode_id_fkey
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
  ALTER TABLE transcripts ADD CONSTRAINT transcripts_episode_id_fkey
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
  ALTER TABLE episode_content ADD CONSTRAINT episode_content_episode_id_fkey
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE NOT VALID;
COMMIT;

ALTER TABLE episodes VALIDATE CONSTRAINT episodes_podcast_id_fkey;
ALTER TABLE episode_content VALIDATE CONSTRAINT episode_content_episode_id_fkey;
