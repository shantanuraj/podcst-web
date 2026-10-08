import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { installFeedTransportFixture } from '../../../scripts/fixtures/feed-transport';
import {
  fixtureLabel,
  withFixtureId,
} from '../../../scripts/lib/identity-fixture';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';

installFeedTransportFixture();

import { indexPodcast as indexCanonicalPodcast } from './index-podcast';
import { resolvePodcast as resolveCanonicalPodcast } from './resolve-podcast';

const resolveFixturePodcast = withFixtureId(resolveCanonicalPodcast);
const resolvePodcast = async (
  ...args: Parameters<typeof resolveFixturePodcast>
) => {
  const id = await resolveFixturePodcast(...args);
  return id === null ? null : fixtureLabel(id);
};
const indexPodcast = async (
  ...args: Parameters<typeof indexCanonicalPodcast>
) => fixtureLabel(await indexCanonicalPodcast(...args));

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `resolve_test_${randomUUID().replaceAll('-', '')}`;
const knownAppleId = 1614253637;
const newAppleId = 6806963519;
const xml = readFileSync(
  new URL('./__fixtures__/refresh.xml', import.meta.url),
  'utf8',
);

describe.skipIf(!databaseUrl)(
  'podcast identity resolution with PostgreSQL',
  () => {
    let sql: postgres.Sql;
    let admin: postgres.Sql;
    let server: ReturnType<typeof Bun.serve>;
    let feedResponse: () => Response;
    let feedRequests: number;

    beforeAll(async () => {
      if (!databaseUrl) throw new Error('TEST_DATABASE_URL required');
      admin = postgres(databaseUrl, { onnotice: () => {} });
      await admin`CREATE SCHEMA ${admin(schema)}`;
      sql = postgres(databaseUrl, {
        connection: { search_path: schema },
        onnotice: () => {},
      });
      await createSchemaFixture(sql);
      server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: () => {
          feedRequests++;
          return feedResponse();
        },
      });
    });

    afterAll(async () => {
      server?.stop(true);
      await sql?.end();
      if (admin) {
        await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
        await admin.end();
      }
    });

    beforeEach(async () => {
      feedRequests = 0;
      feedResponse = () => new Response(xml);
      await sql`TRUNCATE podcasts, authors RESTART IDENTITY CASCADE`;
      await sql`INSERT INTO authors (id, name) VALUES (100, 'Existing author')`;
      await sql`
      INSERT INTO podcasts (id, itunes_id, feed_url, title, author_id, cover)
      VALUES (152, ${knownAppleId}, 'https://example.com/old-feed', 'Search Engine', 100, 'cover')
    `;
    });

    const lookup = (itunesId = newAppleId, feed = server.url.href) =>
      mock(async (_url: string, _init: RequestInit) =>
        Response.json({
          results: [{ collectionId: itunesId, kind: 'podcast', feedUrl: feed }],
        }),
      );
    const counts = async () => {
      const [row] = await sql`
      SELECT (SELECT count(*)::int FROM podcasts) AS podcasts,
             (SELECT count(*)::int FROM authors) AS authors,
             (SELECT count(*)::int FROM episodes) AS episodes
    `;
      return row;
    };

    test('known Apple IDs are reverified before reusing the original source', async () => {
      const request = lookup(knownAppleId, 'https://example.com/old-feed');
      expect(await resolvePodcast(sql, knownAppleId, 'us', request)).toBe(152);
      expect(request).toHaveBeenCalledTimes(1);
      expect(feedRequests).toBe(0);
      expect(await counts()).toEqual({ podcasts: 1, authors: 1, episodes: 0 });
    });

    test('a known listing at a previously unseen feed creates a distinct source without rewriting the old one', async () => {
      const id = await resolvePodcast(
        sql,
        knownAppleId,
        'us',
        lookup(knownAppleId),
      );
      expect(id).not.toBe(152);
      const [old] =
        await sql`SELECT itunes_id,feed_url FROM podcasts WHERE id=152`;
      expect(old).toEqual({
        itunes_id: null,
        feed_url: 'https://example.com/old-feed',
      });
      const [current] =
        await sql`SELECT itunes_id::text,feed_url FROM podcasts WHERE id=${id}`;
      expect(current).toEqual({
        itunes_id: String(knownAppleId),
        feed_url: server.url.href,
      });
      expect((await counts()).podcasts).toBe(2);
    });

    test('new Apple results are indexed with both identities and episode content', async () => {
      const request = lookup();
      const id = await resolvePodcast(sql, newAppleId, 'nl', request);
      expect(id).not.toBeNull();
      expect(id).not.toBe(newAppleId);
      const [podcast] =
        await sql`SELECT id::text, itunes_id::text, feed_url FROM podcasts WHERE id = ${id}`;
      expect(podcast).toEqual({
        id: String(id),
        itunes_id: String(newAppleId),
        feed_url: server.url.href,
      });
      const [content] = await sql`
      SELECT count(*)::int AS count FROM episodes e JOIN episode_content c ON c.episode_id = e.id
      WHERE e.podcast_id = ${id}
    `;
      expect(content.count).toBeGreaterThan(0);
      const [poll] =
        await sql`SELECT failures, last_polled_at FROM feed_poll_state WHERE podcast_id = ${id}`;
      expect(poll.failures).toBe(0);
      expect(poll.last_polled_at).toBeInstanceOf(Date);
      const url = new URL(request.mock.calls[0][0]);
      expect(url.hostname).toBe('itunes.apple.com');
      expect(url.searchParams.get('id')).toBe(String(newAppleId));
      expect(url.searchParams.get('country')).toBe('nl');
      expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    test('existing RSS-only records are reused and gain a verified Apple ID', async () => {
      await sql`UPDATE podcasts SET itunes_id = NULL, feed_url = ${server.url.href} WHERE id = 152`;
      expect(await resolvePodcast(sql, newAppleId, 'us', lookup())).toBe(152);
      const [podcast] =
        await sql`SELECT itunes_id::text FROM podcasts WHERE id = 152`;
      expect(podcast.itunes_id).toBe(String(newAppleId));
      expect(feedRequests).toBe(0);
      expect((await counts()).podcasts).toBe(1);
    });

    test('concurrent selections and RSS ingestion converge on one podcast', async () => {
      const ids = await Promise.all([
        resolvePodcast(sql, newAppleId, 'us', lookup()),
        resolvePodcast(sql, newAppleId, 'us', lookup()),
        indexPodcast(sql, server.url.href),
      ]);
      expect(new Set(ids).size).toBe(1);
      expect(feedRequests).toBeGreaterThanOrEqual(1);
      expect(feedRequests).toBeLessThanOrEqual(3);
      expect((await counts()).podcasts).toBe(2);
      const [podcast] =
        await sql`SELECT itunes_id::text FROM podcasts WHERE id = ${ids[0]}`;
      expect(podcast.itunes_id).toBe(String(newAppleId));
    });

    test('another verified Apple listing is retained without overwriting the preferred ID', async () => {
      await sql`UPDATE podcasts SET feed_url = ${server.url.href} WHERE id = 152`;
      expect(await resolvePodcast(sql, newAppleId, 'us', lookup())).toBe(152);
      const [alias] =
        await sql`SELECT podcast_id FROM podcast_apple_aliases WHERE itunes_id=${newAppleId}`;
      expect(alias.podcast_id).toBe('152');
      const [podcast] =
        await sql`SELECT itunes_id::text FROM podcasts WHERE id = 152`;
      expect(podcast.itunes_id).toBe(String(knownAppleId));
      expect(feedRequests).toBe(0);
    });

    test('unknown or unrelated Apple results do not create podcasts', async () => {
      for (const results of [
        [],
        [{ collectionId: 1, kind: 'podcast', feedUrl: server.url.href }],
        [{ collectionId: newAppleId, kind: 'song', feedUrl: server.url.href }],
      ]) {
        const request = mock(async () => Response.json({ results }));
        expect(await resolvePodcast(sql, newAppleId, 'us', request)).toBeNull();
      }
      expect(await counts()).toEqual({ podcasts: 1, authors: 1, episodes: 0 });
    });

    test('upstream failures leave the database unchanged', async () => {
      for (const response of [
        new Response(null, { status: 503 }),
        Response.json({}),
        Response.json({
          results: [
            {
              collectionId: newAppleId,
              kind: 'podcast',
              feedUrl: 'file:///tmp/feed',
            },
          ],
        }),
      ]) {
        await expect(
          resolvePodcast(sql, newAppleId, 'us', async () => response),
        ).rejects.toThrow();
      }
      feedResponse = () => new Response('not an RSS feed');
      await expect(
        resolvePodcast(sql, newAppleId, 'us', lookup()),
      ).rejects.toThrow();
      expect(await counts()).toEqual({ podcasts: 1, authors: 1, episodes: 0 });
    });

    test('episode write failures roll back the new podcast and Apple identity', async () => {
      await sql`ALTER TABLE episode_content ADD CONSTRAINT reject_content CHECK (title = 'reject')`;
      try {
        await expect(
          resolvePodcast(sql, newAppleId, 'us', lookup()),
        ).rejects.toThrow();
        expect(await counts()).toEqual({
          podcasts: 1,
          authors: 1,
          episodes: 0,
        });
      } finally {
        await sql`ALTER TABLE episode_content DROP CONSTRAINT reject_content`;
      }
    });

    test('invalid Apple IDs never reach the upstream service', async () => {
      const request = lookup();
      for (const id of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        await expect(resolvePodcast(sql, id, 'us', request)).rejects.toThrow(
          'positive integer',
        );
      }
      expect(request).not.toHaveBeenCalled();
    });
  },
);
