DO $$
DECLARE
  source_schema text := current_schema();
BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.guard_public_feed_alias() SET search_path TO pg_catalog, %I, pg_temp',
    source_schema, source_schema
  );
  EXECUTE format(
    'ALTER FUNCTION %I.guard_podcast_alias_claim() SET search_path TO pg_catalog, %I, pg_temp',
    source_schema, source_schema
  );
END
$$;
