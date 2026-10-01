import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import {
  matchSearchResults,
  searchPodcasts,
  searchPodcastsByFeedUrl,
} from './search';

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
    await sql.unsafe(
      readFileSync('migrations/active/0000-baseline.sql', 'utf8'),
    );
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

  test('database text search separates internal and Apple IDs', async () => {
    const results = await searchPodcasts(sql, 'Search');
    expect(results.map((result) => result.id)).toEqual([152, 153]);
    expect(results.map((result) => result.itunes_id)).toEqual([
      1614253637, 6806963519,
    ]);
    expect(results.map((result) => result.feed)).toEqual([feed, largeIdFeed]);
  });

  test('feed URL search uses the same internal identity as text search', async () => {
    const [textResult] = await searchPodcasts(sql, 'Search Engine');
    const result = await searchPodcastsByFeedUrl(sql, feed);
    expect(result?.id).toBe(152);
    expect(result?.itunes_id).toBe(1614253637);
    expect(result).toEqual(textResult);
  });

  test('feed URL search preserves iTunes IDs beyond the 32-bit limit', async () => {
    const result = await searchPodcastsByFeedUrl(sql, largeIdFeed);
    expect(result?.id).toBe(153);
    expect(result?.itunes_id).toBe(6806963519);
  });

  test('private feeds retain their database identity without an Apple ID', async () => {
    const result = await searchPodcastsByFeedUrl(sql, privateFeed);
    expect(result).toMatchObject({
      feed: privateFeed,
      title: 'Search Private',
    });
    expect(result?.id).toBe(154);
    expect(result?.itunes_id).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('itunes_id');
  });

  test('Apple search matches known IDs despite changed feed URLs and preserves ranking', async () => {
    const result = await matchSearchResults(sql, [
      {
        itunes_id: 6806963519,
        feed: largeIdFeed,
        title: 'Second',
        author: '',
        cover: '',
        thumbnail: '',
      },
      {
        itunes_id: 1614253637,
        feed: 'https://example.com/migrated',
        title: 'First',
        author: '',
        cover: '',
        thumbnail: '',
      },
      {
        itunes_id: 999,
        feed: 'https://example.com/new',
        title: 'New',
        author: '',
        cover: '',
        thumbnail: '',
      },
    ]);
    expect(
      result.map(({ id, itunes_id, feed }) => ({ id, itunes_id, feed })),
    ).toEqual([
      { id: 153, itunes_id: 6806963519, feed: largeIdFeed },
      { id: 152, itunes_id: 1614253637, feed },
      { id: undefined, itunes_id: 999, feed: 'https://example.com/new' },
    ]);
    const [count] = await sql`SELECT count(*)::int AS count FROM podcasts`;
    expect(count.count).toBe(3);
  });

  test('unassociated feed matches require verification before binding Apple identity', async () => {
    const [result] = await matchSearchResults(sql, [
      {
        itunes_id: 999,
        feed: privateFeed,
        title: 'Search Private',
        author: '',
        cover: '',
        thumbnail: '',
      },
    ]);
    expect(result.id).toBeUndefined();
    const [stored] = await sql`SELECT itunes_id FROM podcasts WHERE id = 154`;
    expect(stored.itunes_id).toBeNull();
  });

  test('unknown feed URLs return no result', async () => {
    expect(
      await searchPodcastsByFeedUrl(sql, 'https://example.com/missing'),
    ).toBeNull();
  });
});
