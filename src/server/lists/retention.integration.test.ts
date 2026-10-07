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
import { installFeedTransportFixture } from '../../../scripts/fixtures/feed-transport';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';

installFeedTransportFixture();

import { evictWarm } from '../tiering';
import { recoverListContent } from './recovery';
import { createEpisodeListService, type EpisodeListService } from './service';

describe.skipIf(!process.env.PG_BIN)(
  'saved episode retention on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let lists: EpisodeListService;
    let listId: string;

    beforeAll(async () => {
      cluster = startPostgres();
      sql = postgres({ ...cluster.options, max: 8 });
      await createSchemaFixture(sql);
      lists = createEpisodeListService(sql);
    }, 30_000);

    afterAll(async () => {
      await sql?.end();
      await cluster?.stop();
    });

    beforeEach(async () => {
      await sql`TRUNCATE users, authors RESTART IDENTITY CASCADE`;
      await sql`INSERT INTO users (id, email) VALUES ('owner', 'owner@example.invalid'), ('other', 'other@example.invalid')`;
      await sql`INSERT INTO authors (id, name) VALUES (1, 'Author')`;
      await sql`
      INSERT INTO podcasts (id, author_id, feed_url, title, cover, owner_user_id) VALUES
        (1, 1, 'https://public.example.invalid/rss', 'Public', 'cover', NULL),
        (2, 1, 'https://owner.example.invalid/rss', 'Private', 'cover', 'owner'),
        (3, 1, 'https://other.example.invalid/rss', 'Hidden', 'cover', 'other')
    `;
      await sql`
      INSERT INTO episodes (id, podcast_id, guid, published) VALUES
        (101, 1, 'kept', now()), (102, 1, 'missing', now()),
        (201, 2, 'private', now()), (301, 3, 'hidden', now())
    `;
      await sql`
      INSERT INTO episode_content (episode_id, title, file_url) VALUES
        (101, 'Kept', 'https://example.invalid/kept.mp3'),
        (102, 'Other', 'https://example.invalid/other.mp3'),
        (201, 'Private', 'https://example.invalid/private.mp3'),
        (301, 'Hidden', 'https://example.invalid/hidden.mp3')
    `;
      listId = (await lists.lists('owner')).lists[0].id;
    });

    const change = (op: 'add' | 'remove', ...ids: number[]) =>
      lists.change('owner', listId, {
        clientId: randomUUID(),
        sequence: '1',
        changes: ids.map((episodeId) => ({ op, episodeId })),
      });

    async function waitingForPodcastLock() {
      for (let attempt = 0; attempt < 200; attempt++) {
        const [row] = await sql`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event = 'advisory') AS waiting
      `;
        if (row.waiting) return;
        await Bun.sleep(5);
      }
      throw new Error('Expected a blocked podcast lock');
    }

    test('pins individual saved episodes without following their podcast', async () => {
      await change('add', 101, 201);
      expect(await evictWarm(0, sql)).toBe(2);
      expect(
        (
          await sql`SELECT episode_id::int FROM episode_content ORDER BY episode_id`
        ).map((row) => row.episode_id),
      ).toEqual([101, 201]);
      expect(
        (await sql`SELECT is_essential FROM podcasts WHERE id = 1`)[0]
          .is_essential,
      ).toBe(false);
      expect(await sql`SELECT * FROM subscriptions`).toHaveLength(0);
      expect(await evictWarm(0, sql)).toBe(0);
      await change('remove', 101);
      expect(await evictWarm(0, sql)).toBe(1);
      expect(
        (await lists.membership('owner', listId)).items.map(
          ({ episodeId }) => episodeId,
        ),
      ).toEqual([201]);
    });

    test('preserves essential content independently of saved membership', async () => {
      await sql`UPDATE podcasts SET is_essential = true WHERE id = 1`;
      expect(await evictWarm(0, sql)).toBe(2);
      expect(
        (
          await sql`SELECT episode_id::int FROM episode_content ORDER BY episode_id`
        ).map((row) => row.episode_id),
      ).toEqual([101, 102]);
    });

    test('rechecks membership after waiting behind an in-flight add', async () => {
      const ready = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const adding = sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(1::bigint)`;
        ready.resolve();
        await release.promise;
        await tx`INSERT INTO episode_list_items (list_id, episode_id) VALUES (${listId}, 101)`;
      });
      await ready.promise;
      const eviction = evictWarm(0, sql);
      try {
        await waitingForPodcastLock();
      } finally {
        release.resolve();
      }
      await adding;
      expect(await eviction).toBe(3);
      expect(
        (await sql`SELECT episode_id::int FROM episode_content`).map(
          (row) => row.episode_id,
        ),
      ).toEqual([101]);
    });

    test('an add after an in-flight eviction preserves a contentless membership', async () => {
      const ready = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const evicting = sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(1::bigint)`;
        await tx`DELETE FROM episode_content WHERE episode_id = 101`;
        ready.resolve();
        await release.promise;
      });
      await ready.promise;
      const adding = change('add', 101);
      try {
        await waitingForPodcastLock();
      } finally {
        release.resolve();
      }
      await evicting;
      await adding;
      expect((await lists.membership('owner', listId)).items[0]).toMatchObject({
        episodeId: 101,
        availability: 'content_missing',
      });
    });

    test('rebuilds individually evicted content even with a fresh partially retained feed', async () => {
      await change('add', 101, 102);
      await sql`DELETE FROM episode_content WHERE episode_id = 102`;
      let fetches = 0;
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
          fetches++;
          expect(request.headers.get('if-none-match')).toBeNull();
          return new Response(
            '<rss version="2.0"><channel><title>Restored</title><link>https://example.invalid</link><description>Test</description><item><guid>missing</guid><title>Restored episode</title><pubDate>Tue, 06 Jan 2026 00:00:00 GMT</pubDate><enclosure url="https://example.invalid/restored.mp3" length="100" type="audio/mpeg"/></item></channel></rss>',
          );
        },
      });
      try {
        await sql`UPDATE podcasts SET feed_url = ${server.url.href} WHERE id = 1`;
        await sql`
        INSERT INTO feed_poll_state (podcast_id, last_polled_at, next_poll_at, etag)
        VALUES (1, now(), now() + interval '1 day', 'old')
      `;
        await recoverListContent(sql, 'owner', listId, async () => true);
        expect(fetches).toBe(1);
        expect(
          (
            await sql`SELECT title FROM episode_content WHERE episode_id = 102`
          )[0].title,
        ).toBe('Restored episode');
        expect(
          (
            await sql`SELECT title FROM episode_content WHERE episode_id = 101`
          )[0].title,
        ).toBe('Kept');
        expect(
          (await lists.membership('owner', listId)).items.every(
            ({ availability }) => availability === 'available',
          ),
        ).toBe(true);
      } finally {
        server.stop(true);
      }
    });

    test('skips revoked access, foreign lists and feeds in failure backoff', async () => {
      await change('add', 101, 201);
      await sql`DELETE FROM episode_content WHERE episode_id IN (101, 201)`;
      await sql`UPDATE podcasts SET owner_user_id = 'other' WHERE id = 1`;
      await sql`
      INSERT INTO feed_poll_state (podcast_id, failures, next_poll_at)
      VALUES (2, 1, now() + interval '1 day')
    `;
      let claims = 0;
      const claim = async () => {
        claims++;
        return true;
      };
      await recoverListContent(sql, 'owner', listId, claim);
      await recoverListContent(sql, 'other', listId, claim);
      expect(claims).toBe(0);
    });

    test('bounds recovery and skips feeds already claimed by another request', async () => {
      await sql`
      INSERT INTO podcasts (id, author_id, feed_url, title, cover)
      SELECT n, 1, 'https://example.invalid/' || n, 'Show', 'cover' FROM generate_series(4, 8) n
    `;
      await sql`
      INSERT INTO episodes (id, podcast_id, guid, published)
      SELECT 1000 + id, id, 'missing', now() FROM podcasts WHERE id >= 4
    `;
      await change('add', 1004, 1005, 1006, 1007, 1008);
      const refreshed: number[] = [];
      await recoverListContent(
        sql,
        'owner',
        listId,
        async (id) => id !== 4,
        async (_sql, id, mode) => {
          expect(mode).toBe('rebuild');
          refreshed.push(id);
          return 'updated';
        },
      );
      expect(refreshed).toEqual([5, 6, 7]);
    });
  },
);
