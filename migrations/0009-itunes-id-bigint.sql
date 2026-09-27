BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
ALTER TABLE podcasts ALTER COLUMN itunes_id TYPE BIGINT;
COMMIT;
