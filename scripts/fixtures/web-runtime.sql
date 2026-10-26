CREATE ROLE web_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE postgres TO web_runtime;
GRANT USAGE ON SCHEMA public TO web_runtime;

DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND tablename NOT IN ('account_erasure_proofs', 'account_erasure_intents', 'review_accounts')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO web_runtime', target.tablename);
  END LOOP;
END
$$;

GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO web_runtime;
GRANT SELECT ON review_accounts TO web_runtime;
