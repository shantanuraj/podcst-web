import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import postgres from 'postgres';
import { startPostgres } from '../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../scripts/lib/schema-fixture';
import { seedFollow } from '../../scripts/lib/state-fixture';
import { feedFreshness, readFeedState } from './ingest/feed-demand';

describe.skipIf(!process.env.PG_BIN)(
  'subscription reads on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let getSubscriptions: typeof import('./subscriptions').getSubscriptions;
    let statements: string[] = [];

    beforeAll(async () => {
      cluster = startPostgres();
      sql = postgres({
        ...cluster.options,
        debug: (_connection, query) => statements.push(query),
      });
      await createSchemaFixture(sql);
      mock.module('./db', () => ({ sql }));
      ({ getSubscriptions } = await import('./subscriptions'));
    }, 30_000);

    afterAll(async () => {
      mock.restore();
      await sql?.end();
      await cluster?.stop();
    });

    beforeEach(async () => {
      await sql`TRUNCATE users, authors RESTART IDENTITY CASCADE`;
      await sql`INSERT INTO users (id, email) VALUES ('owner', 'owner@example.invalid'), ('other', 'other@example.invalid')`;
      await sql`INSERT INTO authors (id, name) VALUES (1, 'Author')`;
      await sql`
        INSERT INTO podcasts (id, author_id, feed_url, title, cover, episode_count)
        SELECT id, 1, 'https://example.invalid/' || id, 'Podcast ' || id, 'cover', 4
        FROM generate_series(1, 14) id
      `;
      await sql`
        INSERT INTO episodes (id, podcast_id, guid, published)
        SELECT p.id * 100 + n, p.id, 'episode-' || n,
          '2026-01-01'::timestamptz + n * interval '1 day'
        FROM podcasts p CROSS JOIN generate_series(1, 4) n
      `;
      // The newest episode's content was evicted. Limit after joining content.
      await sql`
        INSERT INTO episode_content (episode_id, title, summary, duration, file_url, file_length, file_type)
        SELECT id, 'Episode ' || id, '<p>Notes</p>', 60, 'https://example.invalid/' || id || '.mp3', 12345, 'audio/mp4'
        FROM episodes WHERE id % 100 <> 4
      `;
      await sql`
        INSERT INTO feed_poll_state (podcast_id, last_success_at)
        SELECT id, now() FROM podcasts
      `;
      for (let id = 1; id <= 14; id++)
        await seedFollow(sql, 'owner', id, new Date(2026, 0, id));
      statements = [];
    });

    test('reads a cached library in one query regardless of subscription count', async () => {
      const podcasts = await getSubscriptions('owner');
      expect(podcasts).toHaveLength(14);
      expect(podcasts.map((p) => p.id)).toEqual(
        Array.from({ length: 14 }, (_, i) => String(14 - i)),
      );
      expect(podcasts[0].episodes.map((e) => e.id)).toEqual(['1403', '1402']);
      expect(statements).toHaveLength(1);

      await sql`DELETE FROM subscriptions WHERE podcast_id <> 1`;
      statements = [];
      expect(await getSubscriptions('owner')).toHaveLength(1);
      expect(statements).toHaveLength(1);
    });

    test('preserves episode metadata, defaults, timestamps and large string IDs', async () => {
      await sql`UPDATE episodes SET id = 9007199254740993 WHERE id = 1404`;
      await sql`
        INSERT INTO episode_content (episode_id, title, file_url)
        VALUES (9007199254740993, 'Latest', 'https://example.invalid/latest.mp3')
      `;
      const [podcast] = await getSubscriptions('owner');
      expect(podcast).toMatchObject({
        id: '14',
        isPrivate: false,
        title: 'Podcast 14',
        description: '',
        author: 'Author',
        published: Date.parse('2026-01-05T00:00:00Z'),
        freshness: { content: 'cached', state: 'fresh' },
      });
      expect(podcast.episodes[0]).toEqual({
        id: '9007199254740993',
        podcastId: '14',
        isPrivate: false,
        guid: 'episode-4',
        title: 'Latest',
        summary: null,
        published: Date.parse('2026-01-05T00:00:00Z'),
        duration: null,
        episodeArt: null,
        cover: 'cover',
        explicit: false,
        link: null,
        showNotes: '',
        author: 'Author',
        feed: 'https://example.invalid/14',
        podcastTitle: 'Podcast 14',
        file: {
          url: 'https://example.invalid/latest.mp3',
          length: 0,
          type: 'audio/mpeg',
        },
      });
      expect(podcast.episodes[1]).toMatchObject({
        id: '1403',
        showNotes: '<p>Notes</p>',
        duration: 60,
        file: { length: 12345, type: 'audio/mp4' },
      });
    });

    test('includes owned private feeds and excludes other owners and unfollowed feeds', async () => {
      await sql`UPDATE podcasts SET owner_user_id = 'owner' WHERE id = 14`;
      await sql`UPDATE podcasts SET owner_user_id = 'other' WHERE id = 13`;
      await sql`DELETE FROM subscriptions WHERE podcast_id = 12`;
      const podcasts = await getSubscriptions('owner');
      expect(podcasts).toHaveLength(12);
      expect(podcasts[0]).toMatchObject({ id: '14', isPrivate: true });
      expect(podcasts[0].episodes.every((e) => e.isPrivate)).toBe(true);
      expect(podcasts.some((p) => p.id === '13' || p.id === '12')).toBe(false);
      expect(await getSubscriptions('other')).toEqual([]);
    });

    test('keeps empty validated feeds and matches canonical freshness states', async () => {
      await sql`DELETE FROM episodes WHERE podcast_id = 14`;
      await sql`UPDATE podcasts SET episode_count = 0 WHERE id = 14`;
      await sql`UPDATE feed_poll_state SET last_success_at = now() - interval '2 days' WHERE podcast_id = 13`;
      await sql`UPDATE feed_poll_state SET failures = 1, next_poll_at = now() + interval '1 hour' WHERE podcast_id = 12`;
      await sql`DELETE FROM feed_poll_state WHERE podcast_id = 11`;
      const podcasts = await getSubscriptions('owner');
      expect(podcasts[0]).toMatchObject({
        id: '14',
        episodes: [],
        published: null,
        freshness: { content: 'cached', state: 'fresh' },
      });
      for (const podcast of podcasts) {
        if (!podcast.id) throw new Error('Expected a canonical podcast ID');
        const state = await readFeedState(sql, podcast.id, 'owner');
        if (!state) throw new Error('Expected an accessible feed');
        expect(podcast.freshness).toEqual(feedFreshness(state));
      }
      expect(podcasts[1].freshness?.state).toBe('stale');
      expect(podcasts[2].freshness?.state).toBe('backoff');
      expect(podcasts[3].freshness?.state).toBe('stale');
    });

    test('only attempts repair for the first three missing feeds', async () => {
      await sql`DELETE FROM episode_content WHERE episode_id >= 1000`;
      // Existing demands avoid external admission while exercising real repair reads.
      await sql`
        UPDATE feed_poll_state SET demand_token = gen_random_uuid(), demand_requested_at = now(),
          demand_expires_at = now() + interval '1 hour', demand_rebuild = true
        WHERE podcast_id >= 10
      `;
      const podcasts = await getSubscriptions('owner');
      expect(podcasts).toHaveLength(14);
      for (const podcast of podcasts.slice(0, 5)) {
        expect(podcast.episodes).toEqual([]);
        expect(podcast.freshness).toMatchObject({
          content: 'missing',
          state: 'pending',
        });
      }
      expect(
        (
          await sql`
        SELECT id FROM podcasts WHERE last_accessed_at IS NOT NULL ORDER BY id DESC
      `
        ).map((row) => row.id),
      ).toEqual(['14', '13', '12']);
    });
  },
);
