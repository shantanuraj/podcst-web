import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { searchPodcasts, searchPodcastsByFeedUrl } from './search';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `search_test_${randomUUID().replaceAll('-', '')}`;
const feed = 'https://example.com/search-engine';
const largeIdFeed = 'https://example.com/search-results';
const privateFeed = 'https://example.com/private';

describe.skipIf(!databaseUrl)('search identities with PostgreSQL', () => {
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
    await sql.unsafe(readFileSync('schema.sql', 'utf8'));
    const [author] = await sql`
      INSERT INTO authors (name) VALUES ('Author') RETURNING id
    `;
    await sql`
      INSERT INTO podcasts (id, itunes_id, title, feed_url, author_id, cover, priority)
      VALUES
        (152, 1614253637, 'Search Engine', ${feed}, ${author.id}, 'cover.jpg', 3),
        (153, 6806963519, 'Search Results', ${largeIdFeed}, ${author.id}, 'cover.jpg', 2),
        (154, NULL, 'Search Private', ${privateFeed}, ${author.id}, 'cover.jpg', 1)
    `;
  });

  afterAll(async () => {
    await sql?.end();
    if (admin) {
      await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
      await admin.end();
    }
  });

  test('database text search returns numeric iTunes IDs, not internal IDs', async () => {
    const results = await searchPodcasts(sql, 'Search');
    expect(results.map((result) => result.id)).toEqual([
      1614253637, 6806963519,
    ]);
    expect(results.map((result) => result.feed)).toEqual([feed, largeIdFeed]);
  });

  test('feed URL search uses the same iTunes identity as text search', async () => {
    const [textResult] = await searchPodcasts(sql, 'Search Engine');
    const result = await searchPodcastsByFeedUrl(sql, feed);
    expect(result?.id).toBe(1614253637);
    expect(result).toEqual(textResult);
  });

  test('feed URL search preserves iTunes IDs beyond the 32-bit limit', async () => {
    const result = await searchPodcastsByFeedUrl(sql, largeIdFeed);
    expect(result?.id).toBe(6806963519);
  });

  test('feeds without an iTunes ID never expose their internal ID', async () => {
    const result = await searchPodcastsByFeedUrl(sql, privateFeed);
    expect(result).toMatchObject({
      feed: privateFeed,
      title: 'Search Private',
    });
    expect(result?.id).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('id');
  });

  test('unknown feed URLs return no result', async () => {
    expect(
      await searchPodcastsByFeedUrl(sql, 'https://example.com/missing'),
    ).toBeNull();
  });
});
