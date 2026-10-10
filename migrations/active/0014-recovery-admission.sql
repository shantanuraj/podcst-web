CREATE TABLE recovery_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  run_id UUID NOT NULL,
  incarnation UUID NOT NULL,
  journal_id UUID NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence >= 0),
  hash TEXT NOT NULL CHECK (hash ~ '^[a-f0-9]{64}$'),
  artifact_hash TEXT CHECK (artifact_hash ~ '^[a-f0-9]{64}$'),
  auth_epoch UUID,
  generation UUID,
  database_oid OID,
  database_cluster TEXT,
  database_started_at TIMESTAMPTZ,
  serving_role NAME,
  CHECK ((auth_epoch IS NULL) = (generation IS NULL))
);

REVOKE ALL ON recovery_state FROM PUBLIC;

CREATE FUNCTION require_recovery_admission() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = session_user AND rolsuper) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.recovery_state s JOIN public.state_generation g ON g.singleton
    WHERE s.singleton AND s.auth_epoch IS NOT NULL AND s.generation = g.generation
      AND s.serving_role = session_user
      AND s.database_oid = (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database())
      AND s.database_cluster = (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
      AND s.database_started_at = pg_catalog.pg_postmaster_start_time()
  ) THEN
    RAISE EXCEPTION 'Recovery admission required' USING ERRCODE = '55000';
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('CREATE TRIGGER recovery_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.require_recovery_admission()', target.relname);
  END LOOP;
END;
$$;
