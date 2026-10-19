-- podcst-migration: concurrent-index
CREATE INDEX CONCURRENTLY idx_episodes_podcast_published ON public.episodes (podcast_id, published DESC);
