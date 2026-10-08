CREATE TABLE state_generation (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  generation UUID NOT NULL UNIQUE,
  legacy_generation UUID NOT NULL
);

WITH initial AS (SELECT gen_random_uuid() AS generation)
INSERT INTO state_generation (generation, legacy_generation)
SELECT generation, generation FROM initial;

CREATE TABLE progress_revision_heads (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE follow_revision_heads (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

ALTER TABLE playback_progress ADD COLUMN revision BIGINT;

WITH ordered AS (
  SELECT user_id, episode_id,
    row_number() OVER (PARTITION BY user_id ORDER BY updated_at NULLS FIRST, episode_id) AS revision
  FROM playback_progress
)
UPDATE playback_progress p SET revision = o.revision
FROM ordered o WHERE p.user_id = o.user_id AND p.episode_id = o.episode_id;

ALTER TABLE playback_progress ALTER COLUMN revision SET NOT NULL;
ALTER TABLE playback_progress ADD CHECK (revision > 0);
ALTER TABLE playback_progress ADD CHECK (position >= 0);

INSERT INTO progress_revision_heads (user_id, revision)
SELECT user_id, max(revision) FROM playback_progress GROUP BY user_id;

CREATE INDEX playback_progress_revision ON playback_progress(user_id, revision DESC);

ALTER TABLE subscriptions ADD COLUMN revision BIGINT;

WITH ordered AS (
  SELECT user_id, podcast_id,
    row_number() OVER (PARTITION BY user_id ORDER BY subscribed_at NULLS FIRST, podcast_id) AS revision
  FROM subscriptions
)
UPDATE subscriptions s SET revision = o.revision
FROM ordered o WHERE s.user_id = o.user_id AND s.podcast_id = o.podcast_id;

ALTER TABLE subscriptions ALTER COLUMN revision SET NOT NULL;
ALTER TABLE subscriptions ADD CHECK (revision > 0);

INSERT INTO follow_revision_heads (user_id, revision)
SELECT user_id, max(revision) FROM subscriptions GROUP BY user_id;

CREATE TABLE progress_clients (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  last_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  last_request_hash TEXT,
  last_result JSONB,
  PRIMARY KEY (user_id, client_id),
  CHECK (
    (last_sequence = 0 AND last_request_hash IS NULL AND last_result IS NULL) OR
    (last_sequence > 0 AND last_request_hash IS NOT NULL AND last_result IS NOT NULL)
  )
);

CREATE TABLE follow_clients (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  last_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  last_request_hash TEXT,
  last_result JSONB,
  PRIMARY KEY (user_id, client_id),
  CHECK (
    (last_sequence = 0 AND last_request_hash IS NULL AND last_result IS NULL) OR
    (last_sequence > 0 AND last_request_hash IS NOT NULL AND last_result IS NOT NULL)
  )
);
