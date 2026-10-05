import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import {
  type ChartPodcast,
  refreshTopCharts,
  storeTopPodcasts,
} from './charts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `chart_test_${randomUUID().replaceAll('-', '')}`;
const podcast = (itunesId: number, rank = 1): ChartPodcast => ({
  itunesId,
  rank,
  verifiedAt: new Date().toISOString(),
  title: `Podcast ${itunesId}`,
  author: `Author ${itunesId}`,
  feed: `https://example.com/${itunesId}/feed`,
  cover: 'https://example.com/cover.jpg',
  thumbnail: null,
  explicit: false,
  genres: [],
  count: 10,
});

describe.skipIf(!databaseUrl)('chart ingestion with PostgreSQL', () => {
  let sql: postgres.Sql;
  let admin: postgres.Sql;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL required');
    admin = postgres(databaseUrl, { onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = postgres(databaseUrl, {
      connection: { search_path: schema },
      onnotice: () => {},
    });
    await createSchemaFixture(sql);
  });

  afterAll(async () => {
    await sql?.end();
    if (admin) {
      await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
      await admin.end();
    }
  });

  beforeEach(async () => {
    await sql`TRUNCATE countries, genres, podcasts, authors, poll_metrics RESTART IDENTITY CASCADE`;
    await storeTopPodcasts(sql, [podcast(101)], 'nl');
  });

  const chart = async (locale = 'nl') => {
    const rows = await sql`
      SELECT tp.rank, p.itunes_id::text, tp.fetched_at
      FROM top_podcasts tp JOIN podcasts p ON p.id = tp.podcast_id
      WHERE tp.country_id = ${locale} AND tp.genre_id = 0 ORDER BY tp.rank
    `;
    return [...rows];
  };

  test('stores and looks up Apple IDs beyond the 32-bit integer limit', async () => {
    const result = await storeTopPodcasts(
      sql,
      [podcast(6806963519), podcast(6812915001, 2)],
      'nl',
    );
    expect(result).toEqual({ stored: 2, newPodcasts: 2 });
    expect((await chart()).map((row) => row.itunes_id)).toEqual([
      '6806963519',
      '6812915001',
    ]);
    expect(await storeTopPodcasts(sql, [podcast(6806963519)], 'nl')).toEqual({
      stored: 1,
      newPodcasts: 0,
    });
    const [state] =
      await sql`SELECT count(*)::int AS count FROM feed_poll_state`;
    expect(state.count).toBe(3);
  });

  test('migrates legacy IDs without changing identities or uniqueness', async () => {
    await storeTopPodcasts(sql, [podcast(2147483647)], 'ca');
    const before =
      await sql`SELECT id::text, itunes_id::text FROM podcasts ORDER BY id`;
    const [guard] = await sql`
      SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger
      WHERE tgrelid='podcasts'::regclass AND tgname='guard_podcast_apple_claim'
    `;
    const migration = postgres(databaseUrl ?? '', {
      max: 1,
      connection: { search_path: schema },
      onnotice: () => {},
    });
    await sql`DROP TRIGGER guard_podcast_apple_claim ON podcasts`;
    try {
      await sql`ALTER TABLE podcasts ALTER COLUMN itunes_id TYPE INTEGER`;
      await migration.unsafe(
        readFileSync('migrations/0009-itunes-id-bigint.sql', 'utf8'),
      );
    } finally {
      await migration.end();
      await sql.unsafe(guard.definition);
    }
    const [column] = await sql`
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = ${schema} AND table_name = 'podcasts' AND column_name = 'itunes_id'
    `;
    expect(column.data_type).toBe('bigint');
    const after =
      await sql`SELECT id::text, itunes_id::text FROM podcasts ORDER BY id`;
    expect([...after]).toEqual([...before]);
    await storeTopPodcasts(sql, [podcast(6806963519)], 'nl');
    await expect(
      sql`
      INSERT INTO podcasts (itunes_id, feed_url, title, author_id, cover)
      SELECT itunes_id, 'https://example.com/duplicate', title, author_id, cover
      FROM podcasts WHERE itunes_id = 6806963519
    `.execute(),
    ).rejects.toThrow('duplicate key');
  });

  test('rolls back the whole country when a later chart row fails', async () => {
    const before = await chart();
    await expect(
      storeTopPodcasts(sql, [podcast(6806963519), podcast(6812915001)], 'nl'),
    ).rejects.toThrow('duplicate key');
    expect(await chart()).toEqual(before);
    const [counts] = await sql`
      SELECT (SELECT count(*)::int FROM podcasts) AS podcasts,
             (SELECT count(*)::int FROM authors) AS authors,
             (SELECT count(*)::int FROM feed_poll_state) AS poll_states
    `;
    expect(counts).toEqual({ podcasts: 1, authors: 1, poll_states: 1 });
  });

  test('does not delete the previous chart for an empty replacement', async () => {
    const before = await chart();
    await expect(storeTopPodcasts(sql, [], 'nl')).rejects.toThrow(
      'empty chart',
    );
    expect(await chart()).toEqual(before);
  });

  test('one database failure does not stop subsequent countries', async () => {
    await storeTopPodcasts(sql, [podcast(102)], 'ca');
    const before = await chart('ca');
    const result = await refreshTopCharts(sql, ['ca', 'nl'], async (locale) =>
      locale === 'ca'
        ? [podcast(6812915001), podcast(6809864042)]
        : [podcast(6806963519)],
    );
    expect(result).toEqual({
      stored: 1,
      newPodcasts: 1,
      failedLocales: ['ca'],
    });
    expect(await chart('ca')).toEqual(before);
    expect((await chart())[0].itunes_id).toBe('6806963519');
    const metrics =
      await sql`SELECT metric_name, metric_value FROM poll_metrics`;
    expect(
      Object.fromEntries(
        metrics.map((row) => [row.metric_name, row.metric_value]),
      ),
    ).toEqual({
      top_charts_stored: 1,
      top_charts_new_podcasts: 1,
      top_charts_failed: 1,
    });
  });

  test('upstream failures preserve previous charts and allow other countries to refresh', async () => {
    const before = await chart();
    const result = await refreshTopCharts(sql, ['nl', 'us'], async (locale) => {
      if (locale === 'nl') throw new Error('Apple returned HTTP 503');
      return [podcast(6812915001)];
    });
    expect(result.failedLocales).toEqual(['nl']);
    expect(await chart()).toEqual(before);
    expect((await chart('us'))[0].itunes_id).toBe('6812915001');
  });

  test('matches existing feed URLs and fills missing Apple IDs without duplicating podcasts', async () => {
    const [existing] = await sql`SELECT id FROM podcasts WHERE itunes_id = 101`;
    await sql`UPDATE podcasts SET itunes_id = NULL WHERE id = ${existing.id}`;
    const replacement = { ...podcast(6806963519), feed: podcast(101).feed };
    expect(await storeTopPodcasts(sql, [replacement], 'nl')).toEqual({
      stored: 1,
      newPodcasts: 0,
    });
    const [row] = await sql`SELECT id, itunes_id::text FROM podcasts`;
    expect(row.id).toBe(existing.id);
    expect(row.itunes_id).toBe('6806963519');
  });

  test('rejects conflicting provider and feed identities without replacing the chart', async () => {
    await storeTopPodcasts(sql, [podcast(6806963519)], 'ca');
    const before = await chart();
    const replacement = { ...podcast(6806963519), feed: podcast(101).feed };
    await expect(storeTopPodcasts(sql, [replacement], 'nl')).rejects.toThrow(
      'different podcasts',
    );
    expect(await chart()).toEqual(before);
  });

  test('preserves failure backoff and unrelated genres while replacing a chart', async () => {
    await sql`UPDATE feed_poll_state SET failures = 3, next_poll_at = now() + interval '1 day'`;
    const [before] =
      await sql`SELECT failures, next_poll_at FROM feed_poll_state`;
    await sql`INSERT INTO genres (id, name) VALUES (1, 'Test genre')`;
    await sql`
      INSERT INTO top_podcasts (country_id, genre_id, rank, podcast_id)
      SELECT 'nl', 1, 1, id FROM podcasts WHERE itunes_id = 101
    `;
    await storeTopPodcasts(sql, [podcast(101)], 'nl');
    const [after] =
      await sql`SELECT failures, next_poll_at FROM feed_poll_state`;
    expect(after).toEqual(before);
    const [genre] =
      await sql`SELECT count(*)::int AS count FROM top_podcasts WHERE genre_id = 1`;
    expect(genre.count).toBe(1);
  });

  test('concurrent imports of one country leave one complete chart, not a mixture', async () => {
    const first = [podcast(6806963519), podcast(6812915001, 2)];
    const second = [podcast(6809864042), podcast(6811266682, 2)];
    await Promise.all([
      storeTopPodcasts(sql, first, 'nl'),
      storeTopPodcasts(sql, second, 'nl'),
    ]);
    const ids = (await chart()).map((row) => row.itunes_id);
    expect(
      [first, second].some(
        (rows) =>
          rows.map((row) => String(row.itunesId)).join(',') === ids.join(','),
      ),
    ).toBe(true);
  });
});
