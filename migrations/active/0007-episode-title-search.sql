SET LOCAL maintenance_work_mem = '1GB';

CREATE INDEX idx_episode_content_title_search
  ON episode_content USING gin (to_tsvector('english', title));
