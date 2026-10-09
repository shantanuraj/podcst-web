ALTER TABLE feed_poll_state
  ADD COLUMN last_success_at TIMESTAMPTZ,
  ADD COLUMN last_rebuilt_at TIMESTAMPTZ,
  ADD COLUMN demand_token UUID,
  ADD COLUMN demand_requested_at TIMESTAMPTZ,
  ADD COLUMN demand_expires_at TIMESTAMPTZ,
  ADD COLUMN demand_rebuild BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT feed_refresh_demand_shape CHECK (
    (demand_token IS NULL AND demand_requested_at IS NULL AND demand_expires_at IS NULL AND NOT demand_rebuild)
    OR (demand_token IS NOT NULL AND demand_requested_at IS NOT NULL AND demand_expires_at IS NOT NULL AND demand_expires_at > demand_requested_at)
  );

CREATE INDEX feed_refresh_demand_due ON feed_poll_state (demand_expires_at, demand_requested_at)
  WHERE demand_token IS NOT NULL;
CREATE INDEX feed_refresh_active_leases ON feed_poll_state (refresh_expires_at)
  WHERE refresh_token IS NOT NULL;

CREATE OR REPLACE FUNCTION invalidate_feed_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE feed_poll_state SET
    refresh_token = NULL,
    refresh_expires_at = NULL,
    demand_token = NULL,
    demand_requested_at = NULL,
    demand_expires_at = NULL,
    demand_rebuild = false,
    last_success_at = NULL,
    last_rebuilt_at = NULL,
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
