CREATE TABLE podcast_apple_aliases (
  itunes_id bigint PRIMARY KEY CHECK (itunes_id > 0 AND itunes_id <= 9007199254740991),
  podcast_id bigint NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  evidence_type text NOT NULL CHECK (evidence_type IN ('apple_lookup', 'reviewed')),
  evidence_reference text NOT NULL CHECK (length(evidence_reference) BETWEEN 1 AND 512),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_podcast_apple_aliases_podcast ON podcast_apple_aliases(podcast_id);

CREATE FUNCTION guard_public_apple_alias() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_owner text;
  preferred_id bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Apple identity writes require read committed isolation' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('podcast:itunes'), hashtext(NEW.itunes_id::text));
  SELECT owner_user_id, itunes_id INTO source_owner, preferred_id
    FROM podcasts WHERE id = NEW.podcast_id FOR UPDATE;
  IF NOT FOUND OR source_owner IS NOT NULL OR preferred_id IS NULL THEN
    RAISE EXCEPTION 'Apple alias target must be public with a preferred listing' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.podcast_id <> OLD.podcast_id OR NEW.itunes_id <> OLD.itunes_id) THEN
    RAISE EXCEPTION 'Apple alias reassignment requires reconciliation' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM podcasts WHERE itunes_id = NEW.itunes_id) THEN
    RAISE EXCEPTION 'Apple ID is already a preferred listing' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER guard_public_apple_alias BEFORE INSERT OR UPDATE ON podcast_apple_aliases
FOR EACH ROW EXECUTE FUNCTION guard_public_apple_alias();

CREATE FUNCTION guard_podcast_apple_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Apple identity writes require read committed isolation' USING ERRCODE = '0A000';
  END IF;
  IF NEW.itunes_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('podcast:itunes'), hashtext(NEW.itunes_id::text));
    IF EXISTS (SELECT 1 FROM podcast_apple_aliases WHERE itunes_id = NEW.itunes_id) THEN
      RAISE EXCEPTION 'Apple ID is already an accepted alias' USING ERRCODE = '23505';
    END IF;
  END IF;
  IF (NEW.owner_user_id IS NOT NULL OR NEW.itunes_id IS NULL)
    AND EXISTS (SELECT 1 FROM podcast_apple_aliases WHERE podcast_id = NEW.id) THEN
    RAISE EXCEPTION 'Remove Apple aliases before changing source eligibility' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER guard_podcast_apple_claim BEFORE INSERT OR UPDATE OF itunes_id, owner_user_id ON podcasts
FOR EACH ROW EXECUTE FUNCTION guard_podcast_apple_claim();

DO $$
DECLARE
  source_schema text := current_schema();
BEGIN
  EXECUTE format(
    'ALTER FUNCTION %I.guard_public_apple_alias() SET search_path TO pg_catalog, %I, pg_temp',
    source_schema, source_schema
  );
  EXECUTE format(
    'ALTER FUNCTION %I.guard_podcast_apple_claim() SET search_path TO pg_catalog, %I, pg_temp',
    source_schema, source_schema
  );
END
$$;
