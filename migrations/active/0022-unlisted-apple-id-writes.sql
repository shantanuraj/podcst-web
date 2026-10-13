DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'podcst_app') THEN
    EXECUTE 'GRANT INSERT, UPDATE, DELETE ON public.unlisted_apple_ids TO podcst_app';
  END IF;
END
$$;
