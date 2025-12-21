CREATE TABLE authors (
  id SERIAL PRIMARY KEY,
  itunes_id TEXT UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE genres (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES genres(id),
  name TEXT NOT NULL
);

CREATE TABLE countries (
  id VARCHAR(2) PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE podcasts (
  id SERIAL PRIMARY KEY,
  itunes_id INTEGER UNIQUE,
  feed_url TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  author_id INTEGER NOT NULL REFERENCES authors(id),
  description TEXT,
  cover TEXT NOT NULL,
  thumbnail TEXT,
  website_url TEXT,
  explicit BOOLEAN NOT NULL DEFAULT false,
  episode_count INTEGER NOT NULL DEFAULT 0,
  last_published TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE podcasts_genres (
  podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (podcast_id, genre_id)
);

CREATE TABLE top_podcasts (
  country_id VARCHAR(2) NOT NULL REFERENCES countries(id),
  genre_id INTEGER NOT NULL REFERENCES genres(id),
  rank INTEGER NOT NULL,
  podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (country_id, genre_id, rank)
);

CREATE TABLE episodes (
  id SERIAL PRIMARY KEY,
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

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  image TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT UNIQUE NOT NULL,
  public_key BYTEA NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE oauth_accounts (
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (provider, provider_account_id)
);

CREATE TABLE subscriptions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  subscribed_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, podcast_id)
);

CREATE TABLE playback_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, episode_id)
);

CREATE TABLE transcripts (
  episode_id INTEGER PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  segments JSONB,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_podcasts_feed_url ON podcasts(feed_url);
CREATE INDEX idx_podcasts_itunes_id ON podcasts(itunes_id);
CREATE INDEX idx_podcasts_updated ON podcasts(updated_at);
CREATE INDEX idx_episodes_podcast ON episodes(podcast_id);
CREATE INDEX idx_episodes_published ON episodes(published DESC);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_passkeys_user ON passkeys(user_id);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_playback_user ON playback_progress(user_id);
CREATE INDEX idx_playback_updated ON playback_progress(updated_at);
CREATE INDEX idx_top_podcasts_country_genre ON top_podcasts(country_id, genre_id);
CREATE INDEX idx_transcripts_search ON transcripts USING gin(to_tsvector('english', content));
