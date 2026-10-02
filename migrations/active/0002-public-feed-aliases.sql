CREATE TABLE podcast_feed_aliases (
  feed_url text PRIMARY KEY,
  podcast_id bigint NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  evidence_type text NOT NULL CHECK (evidence_type IN ('reviewed', 'permanent_redirect')),
  evidence_reference text NOT NULL CHECK (length(evidence_reference) BETWEEN 1 AND 512),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_podcast_feed_aliases_podcast ON podcast_feed_aliases(podcast_id);

CREATE FUNCTION guard_public_feed_alias() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_owner text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('podcast:feed'), hashtext(NEW.feed_url));
  SELECT owner_user_id INTO source_owner FROM podcasts WHERE id = NEW.podcast_id FOR UPDATE;
  IF NOT FOUND OR source_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Alias target must be public' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.podcast_id <> OLD.podcast_id OR NEW.feed_url <> OLD.feed_url) THEN
    RAISE EXCEPTION 'Alias reassignment requires reconciliation' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM podcasts WHERE feed_url = NEW.feed_url AND id <> NEW.podcast_id) THEN
    RAISE EXCEPTION 'Locator belongs to another source' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER guard_public_feed_alias BEFORE INSERT OR UPDATE ON podcast_feed_aliases
FOR EACH ROW EXECUTE FUNCTION guard_public_feed_alias();

CREATE FUNCTION guard_podcast_alias_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('podcast:feed'), hashtext(NEW.feed_url));
  IF EXISTS (SELECT 1 FROM podcast_feed_aliases WHERE feed_url = NEW.feed_url AND podcast_id <> NEW.id) THEN
    RAISE EXCEPTION 'Locator is an accepted alias of another source' USING ERRCODE = '23505';
  END IF;
  IF NEW.owner_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM podcast_feed_aliases WHERE podcast_id = NEW.id) THEN
    RAISE EXCEPTION 'Remove public aliases before changing ownership' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER guard_podcast_alias_claim BEFORE INSERT OR UPDATE OF feed_url, owner_user_id ON podcasts
FOR EACH ROW EXECUTE FUNCTION guard_podcast_alias_claim();
