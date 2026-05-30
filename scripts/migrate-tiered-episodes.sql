\set ON_ERROR_STOP on

UPDATE podcasts p SET is_essential = true
WHERE p.id IN (
  SELECT podcast_id FROM subscriptions
  UNION SELECT podcast_id FROM top_podcasts
  UNION SELECT e.podcast_id FROM playback_progress pp JOIN episodes e ON e.id = pp.episode_id
        WHERE pp.updated_at > now() - interval '90 days'
);

CREATE TABLE episodes_identity (
  id bigint NOT NULL,
  podcast_id bigint NOT NULL,
  guid text NOT NULL,
  published timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
INSERT INTO episodes_identity (id, podcast_id, guid, published, created_at)
  SELECT id, podcast_id, guid, published, created_at FROM episodes;

INSERT INTO episode_content (episode_id, title, summary, duration, episode_art, file_url, file_length, file_type)
  SELECT e.id, e.title, e.summary, e.duration, e.episode_art, e.file_url, e.file_length, e.file_type
  FROM episodes e
  WHERE e.podcast_id IN (SELECT id FROM podcasts WHERE is_essential);

ALTER TABLE episodes_identity ADD PRIMARY KEY (id);
ALTER TABLE episodes_identity ADD CONSTRAINT episodes_podcast_id_guid_key UNIQUE (podcast_id, guid);
CREATE INDEX idx_episodes_podcast ON episodes_identity(podcast_id);
CREATE INDEX idx_episodes_published ON episodes_identity(published DESC);

DO $$
DECLARE old_n bigint; new_n bigint; old_max bigint; new_max bigint;
BEGIN
  SELECT count(*), max(id) INTO old_n, old_max FROM episodes;
  SELECT count(*), max(id) INTO new_n, new_max FROM episodes_identity;
  IF old_n <> new_n OR old_max <> new_max THEN
    RAISE EXCEPTION 'identity parity failed: old(%,%) new(%,%)', old_n, old_max, new_n, new_max;
  END IF;
END $$;

BEGIN;
  ALTER TABLE playback_progress DROP CONSTRAINT playback_progress_episode_id_fkey;
  ALTER TABLE transcripts DROP CONSTRAINT transcripts_episode_id_fkey;
  ALTER TABLE episodes RENAME TO episodes_old;
  ALTER TABLE episodes_identity RENAME TO episodes;
  ALTER SEQUENCE episodes_id_seq OWNED BY episodes.id;
  ALTER TABLE episodes ALTER COLUMN id SET DEFAULT nextval('episodes_id_seq');
  SELECT setval('episodes_id_seq', (SELECT max(id) FROM episodes));
  ALTER TABLE episodes ADD CONSTRAINT episodes_podcast_id_fkey
    FOREIGN KEY (podcast_id) REFERENCES podcasts(id) ON DELETE CASCADE;
  ALTER TABLE playback_progress ADD CONSTRAINT playback_progress_episode_id_fkey
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
  ALTER TABLE transcripts ADD CONSTRAINT transcripts_episode_id_fkey
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
  ALTER TABLE episode_content ADD CONSTRAINT episode_content_episode_id_fkey
    FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
COMMIT;
