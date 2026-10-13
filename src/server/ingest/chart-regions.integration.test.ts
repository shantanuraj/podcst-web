import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { claimRotationRegions, requestChartRefresh } from './chart-regions';

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseAvailable = Boolean(databaseUrl || process.env.PG_BIN);
const schema = `chart_regions_test_${randomUUID().replaceAll('-', '')}`;

describe.skipIf(!databaseAvailable)(
  'chart region rotation with PostgreSQL',
  () => {
    let sql: postgres.Sql;
    let admin: postgres.Sql;
    let cluster: ReturnType<typeof startPostgres> | undefined;

    beforeAll(async () => {
      let connectionString: string;
      if (databaseUrl) connectionString = databaseUrl;
      else {
        cluster = startPostgres({ tcp: true });
        connectionString = cluster.url;
      }
      admin = postgres(connectionString, { onnotice: () => {} });
      await admin`CREATE SCHEMA ${admin(schema)}`;
      sql = postgres(connectionString, {
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
      await cluster?.stop();
    });

    beforeEach(async () => {
      await sql`TRUNCATE countries, genres, podcasts, authors RESTART IDENTITY CASCADE`;
      await sql`INSERT INTO genres (id, name) VALUES (0, 'All')`;
      await sql`INSERT INTO authors (id, name) VALUES (1, 'Author')`;
      await sql`
      INSERT INTO countries (id, name) VALUES
        ('us', 'US'), ('nl', 'NL'), ('gb', 'GB'), ('de', 'DE'), ('it', 'IT'), ('jp', 'JP'), ('zw', 'ZW')
    `;
      await sql`
      INSERT INTO podcasts (id, feed_url, title, author_id, cover) VALUES
        (1, 'https://example.com/1', 'Main', 1, ''),
        (2, 'https://example.com/2', 'Stale', 1, ''),
        (3, 'https://example.com/3', 'Fresh', 1, '')
    `;
      await sql`
      INSERT INTO top_podcasts (country_id, genre_id, rank, podcast_id, fetched_at) VALUES
        ('us', 0, 1, 1, now()),
        ('gb', 0, 1, 2, now() - interval '2 days'),
        ('de', 0, 1, 3, now() - interval '1 hour')
    `;
    });

    test('a stale non-main chart is requested at most once an hour', async () => {
      expect(await requestChartRefresh(sql, 'gb')).toBe(true);
      expect(await requestChartRefresh(sql, 'gb')).toBe(false);
      await sql`UPDATE countries SET chart_requested_at = now() - interval '2 hours' WHERE id = 'gb'`;
      expect(await requestChartRefresh(sql, 'gb')).toBe(true);
    });

    test('main, fresh, unknown and malformed regions are not requested', async () => {
      await sql`UPDATE top_podcasts SET fetched_at = now() - interval '3 days' WHERE country_id = 'us'`;
      for (const locale of ['us', 'de', 'xx', 'GB', "gb'--", ''])
        expect(await requestChartRefresh(sql, locale)).toBe(false);
      const [{ n }] =
        await sql`SELECT count(*)::int AS n FROM countries WHERE chart_requested_at IS NOT NULL`;
      expect(n).toBe(0);
    });

    test('a region that never stored a chart can be requested', async () => {
      expect(await requestChartRefresh(sql, 'jp')).toBe(true);
    });

    test('rotation serves requests first, then the least recently attempted, never main regions', async () => {
      await sql`UPDATE countries SET chart_attempted_at = now() - interval '5 hours' WHERE id IN ('de', 'it', 'jp', 'zw')`;
      await sql`UPDATE countries SET chart_attempted_at = now() - interval '9 hours' WHERE id = 'jp'`;
      await sql`UPDATE countries SET chart_attempted_at = now() - interval '1 hour', chart_requested_at = now() WHERE id = 'zw'`;
      expect(await claimRotationRegions(sql, 3)).toEqual(['gb', 'jp', 'zw']);
      const attempted = await sql`
      SELECT id FROM countries WHERE chart_attempted_at > now() - interval '1 minute' ORDER BY id
    `;
      expect(attempted.map(({ id }) => id)).toEqual(['gb', 'jp', 'zw']);
      expect(await claimRotationRegions(sql, 10)).toEqual([
        'de',
        'gb',
        'it',
        'jp',
        'zw',
      ]);
    });

    test('a served request is not served again until requested again', async () => {
      await sql`UPDATE countries SET chart_attempted_at = now() WHERE id <> 'gb'`;
      await sql`UPDATE countries SET chart_attempted_at = now() - interval '1 minute', chart_requested_at = now() - interval '2 minutes' WHERE id = 'gb'`;
      await sql`UPDATE countries SET chart_attempted_at = now() - interval '30 seconds' WHERE id = 'it'`;
      expect(await claimRotationRegions(sql, 1)).toEqual(['gb']);
      expect(await claimRotationRegions(sql, 1)).toEqual(['it']);
    });
  },
);
