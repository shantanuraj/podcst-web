import { expectTypeOf, test } from 'bun:test';
import type postgres from 'postgres';
import type { upsertEpisodes } from './episodes';
import type { savePollState } from './feed-refresh';

test('ingestion query helpers accept pooled and transaction clients', () => {
  type QueryClient = Parameters<typeof upsertEpisodes>[0] &
    Parameters<typeof savePollState>[0];

  expectTypeOf<postgres.ISql>().toExtend<QueryClient>();
  expectTypeOf<postgres.Sql>().toExtend<QueryClient>();
  expectTypeOf<postgres.TransactionSql>().toExtend<QueryClient>();
});
