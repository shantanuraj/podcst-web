BEGIN;

ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_podcast_id_fkey;
ALTER TABLE podcasts_genres DROP CONSTRAINT IF EXISTS podcasts_genres_podcast_id_fkey;
ALTER TABLE top_podcasts DROP CONSTRAINT IF EXISTS top_podcasts_podcast_id_fkey;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_podcast_id_fkey;
ALTER TABLE feed_poll_state DROP CONSTRAINT IF EXISTS feed_poll_state_podcast_id_fkey;

ALTER TABLE podcasts ALTER COLUMN id SET DATA TYPE bigint;
ALTER SEQUENCE podcasts_id_seq AS bigint;

ALTER TABLE episodes ALTER COLUMN podcast_id SET DATA TYPE bigint;
ALTER TABLE podcasts_genres ALTER COLUMN podcast_id SET DATA TYPE bigint;
ALTER TABLE top_podcasts ALTER COLUMN podcast_id SET DATA TYPE bigint;
ALTER TABLE subscriptions ALTER COLUMN podcast_id SET DATA TYPE bigint;
ALTER TABLE feed_poll_state ALTER COLUMN podcast_id SET DATA TYPE bigint;

ALTER TABLE episodes ADD CONSTRAINT episodes_podcast_id_fkey
  FOREIGN KEY (podcast_id) REFERENCES podcasts(id) ON DELETE CASCADE;
ALTER TABLE podcasts_genres ADD CONSTRAINT podcasts_genres_podcast_id_fkey
  FOREIGN KEY (podcast_id) REFERENCES podcasts(id) ON DELETE CASCADE;
ALTER TABLE top_podcasts ADD CONSTRAINT top_podcasts_podcast_id_fkey
  FOREIGN KEY (podcast_id) REFERENCES podcasts(id) ON DELETE CASCADE;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_podcast_id_fkey
  FOREIGN KEY (podcast_id) REFERENCES podcasts(id) ON DELETE CASCADE;
ALTER TABLE feed_poll_state ADD CONSTRAINT feed_poll_state_podcast_id_fkey
  FOREIGN KEY (podcast_id) REFERENCES podcasts(id) ON DELETE CASCADE;

COMMIT;
