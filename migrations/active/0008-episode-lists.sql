CREATE TABLE episode_lists (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('starred', 'playlist')),
  name TEXT,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'starred' AND name IS NULL) OR
    (kind = 'playlist' AND name IS NOT NULL AND name = btrim(name) AND char_length(name) BETWEEN 1 AND 100)
  )
);

CREATE UNIQUE INDEX episode_lists_starred ON episode_lists(user_id) WHERE kind = 'starred';
CREATE INDEX episode_lists_user ON episode_lists(user_id);

CREATE TABLE episode_list_items (
  list_id UUID NOT NULL REFERENCES episode_lists(id) ON DELETE CASCADE,
  episode_id BIGINT NOT NULL REFERENCES episodes(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  added_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (list_id, episode_id)
);

CREATE INDEX episode_list_items_order ON episode_list_items(list_id, added_at DESC, episode_id DESC);
CREATE INDEX episode_list_items_episode ON episode_list_items(episode_id);

CREATE TABLE episode_list_clients (
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
