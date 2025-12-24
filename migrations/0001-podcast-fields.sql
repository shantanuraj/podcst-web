ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS podcast_index_id INTEGER UNIQUE;
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS language VARCHAR(10);
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS popularity_score INTEGER;
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS priority INTEGER;
ALTER TABLE podcasts ADD COLUMN IF NOT EXISTS update_frequency INTEGER;

CREATE INDEX IF NOT EXISTS idx_podcasts_podcast_index_id ON podcasts(podcast_index_id);
CREATE INDEX IF NOT EXISTS idx_podcasts_is_active ON podcasts(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_podcasts_popularity ON podcasts(popularity_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_podcasts_search ON podcasts USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '')));
