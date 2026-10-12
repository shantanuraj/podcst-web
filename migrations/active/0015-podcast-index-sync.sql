CREATE TABLE podcast_index_sync_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  last_update BIGINT NOT NULL DEFAULT 0 CHECK (last_update >= 0),
  last_id BIGINT NOT NULL DEFAULT 0 CHECK (last_id >= 0),
  completed_at TIMESTAMPTZ
);

INSERT INTO podcast_index_sync_state (singleton) VALUES (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'podcst_app') THEN
    EXECUTE 'ALTER TABLE public.podcast_index_sync_state OWNER TO podcst_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.podcast_index_sync_state TO podcst_app';
  END IF;
END
$$;
