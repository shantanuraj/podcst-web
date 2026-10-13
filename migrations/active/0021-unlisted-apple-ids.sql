CREATE TABLE unlisted_apple_ids (
  itunes_id BIGINT PRIMARY KEY CHECK (itunes_id > 0 AND itunes_id <= 9007199254740991),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'podcst_app') THEN
    EXECUTE 'GRANT SELECT ON public.unlisted_apple_ids TO podcst_app';
  END IF;
END
$$;
