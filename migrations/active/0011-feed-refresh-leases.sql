ALTER TABLE feed_poll_state
  ADD COLUMN refresh_token UUID,
  ADD COLUMN refresh_expires_at TIMESTAMPTZ,
  ADD CONSTRAINT feed_refresh_lease_pair CHECK (
    (refresh_token IS NULL) = (refresh_expires_at IS NULL)
  );

CREATE FUNCTION invalidate_feed_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE feed_poll_state SET
    refresh_token = NULL,
    refresh_expires_at = NULL,
    etag = NULL,
    last_modified = NULL,
    hash = NULL,
    last_polled_at = NULL,
    next_poll_at = clock_timestamp(),
    failures = 0
  WHERE podcast_id = NEW.id;
  RETURN NEW;
END
$$;

DO $$
DECLARE
  source_schema text := current_schema();
BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.invalidate_feed_refresh() SET search_path TO pg_catalog, %I, pg_temp',
    source_schema, source_schema
  );
END
$$;

CREATE TRIGGER invalidate_feed_refresh
AFTER UPDATE OF feed_url, owner_user_id ON podcasts
FOR EACH ROW WHEN (
  OLD.feed_url IS DISTINCT FROM NEW.feed_url OR
  OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id
)
EXECUTE FUNCTION invalidate_feed_refresh();
