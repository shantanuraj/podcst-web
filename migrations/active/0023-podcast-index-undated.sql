ALTER TABLE podcast_index_sync_state
  ADD COLUMN undated_last_id BIGINT NOT NULL DEFAULT 0 CHECK (undated_last_id >= 0);
