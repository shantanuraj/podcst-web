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
import { createEpisodeListService } from '../lists/service';
import { evictWarm } from '../tiering';
import { refreshFeed } from './feed-refresh';
import { getDuePodcasts } from './feed-schedule';

installFeedTransportFixture();

const podcastId = '9007199254740993';
const feed = (title: string) =>
  `<rss version="2.0"><channel><title>${title}</title><description>Fixture</description><item><guid>episode</guid><title>${title}</title><enclosure url="https://example.invalid/audio.mp3" type="audio/mpeg" length="100"/></item></channel></rss>`;

describe.skipIf(!process.env.PG_BIN)(
  'refresh leases on disposable PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let observer: postgres.Sql;
    let server: ReturnType<typeof Bun.serve>;
    let respond: () => Promise<Response>;
    let requests = 0;

    beforeAll(async () => {
      cluster = startPostgres();
      sql = cluster.sql;
      observer = postgres({ ...cluster.options, max: 3 });
      await createSchemaFixture(sql);
      server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch() {
          requests++;
          return respond();
        },
      });
    }, 30_000);

    afterAll(async () => {
      server?.stop(true);
      await observer?.end();
      await cluster?.stop();
    });

    beforeEach(async () => {
      requests = 0;
      respond = async () => new Response(feed('Fetched'));
      await sql`TRUNCATE users, authors RESTART IDENTITY CASCADE`;
      await sql`INSERT INTO users (id, email) VALUES ('owner', 'owner@example.invalid'), ('other', 'other@example.invalid')`;
      await sql`INSERT INTO authors (id, name) VALUES (1, 'Author')`;
      await sql`INSERT INTO podcasts (id, author_id, feed_url, title, cover, is_essential)
      VALUES (${podcastId}, 1, ${server.url.href}, 'Cached', 'cover', true)`;
      await sql`INSERT INTO feed_poll_state (podcast_id, next_poll_at, failures) VALUES (${podcastId}, now() - interval '1 hour', 0)`;
    });

    async function pause(success = true) {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      respond = async () => {
        started.resolve();
        await release.promise;
        return success
          ? new Response(feed('Delayed'))
          : new Response(null, { status: 503 });
      };
      const result = refreshFeed(sql, podcastId, 'scheduled');
      await started.promise;
      return { result, release: () => release.resolve() };
    }

    const state = async () =>
      (
        await observer`SELECT * FROM feed_poll_state WHERE podcast_id = ${podcastId}`
      )[0];
    const title = async () =>
      (await observer`SELECT title FROM podcasts WHERE id = ${podcastId}`)[0]
        ?.title;

    test('does not hold the connection or podcast advisory lock during network I/O', async () => {
      const pending = await pause();
      let available: boolean | null = null;
      let acquired = false;
      try {
        available = await Promise.race([
          sql`SELECT true AS available`.then(
            (rows) => rows[0].available as boolean,
          ),
          Bun.sleep(200).then(() => null),
        ]);
        acquired = await observer.begin(
          async (tx) =>
            (
              await tx`SELECT pg_try_advisory_xact_lock(${podcastId}::bigint) AS acquired`
            )[0].acquired,
        );
      } finally {
        pending.release();
        await pending.result;
      }
      expect(available).toBe(true);
      expect(acquired).toBe(true);
    });

    test('allows Starred writes during fetch and preserves saved-content retention at commit', async () => {
      const episodeId = '9007199254740994';
      await sql`INSERT INTO episodes (id, podcast_id, guid, published) VALUES (${episodeId}, ${podcastId}, 'episode', now())`;
      await sql`INSERT INTO episode_content (episode_id, title, file_url) VALUES (${episodeId}, 'Cached', 'https://example.invalid/audio.mp3')`;
      const lists = createEpisodeListService(observer);
      const collection = await lists.lists('owner');
      const pending = await pause();
      const adding = lists.change('owner', collection.lists[0].id, {
        protocol: 1,
        accountId: 'owner',
        generation: collection.generation,
        clientId: randomUUID(),
        sequence: '1',
        changes: [{ op: 'add', episodeId }],
      });
      let completed = false;
      try {
        completed = await Promise.race([
          adding.then(() => true),
          Bun.sleep(500).then(() => false),
        ]);
      } finally {
        pending.release();
        await pending.result;
        await adding;
      }
      expect(completed).toBe(true);
      await sql`UPDATE podcasts SET is_essential = false WHERE id = ${podcastId}`;
      expect(await evictWarm(0, sql)).toBe(0);
      expect(
        (await sql`SELECT episode_id, title FROM episode_content`)[0],
      ).toEqual({ episode_id: episodeId, title: 'Delayed' });
      expect(
        (await lists.membership('owner', collection.lists[0].id)).items[0]
          .episodeId,
      ).toBe(episodeId);
    });

    test('coalesces workers with a durable lease and excludes active claims from polling', async () => {
      const pending = await pause();
      try {
        expect((await state()).refresh_token).toBeString();
        expect(await refreshFeed(observer, podcastId, 'rebuild')).toBe('busy');
        expect(await getDuePodcasts(observer, 10)).toEqual([]);
        expect(requests).toBe(1);
      } finally {
        pending.release();
        await pending.result;
      }
      expect((await state()).refresh_token).toBeNull();
      expect((await state()).refresh_expires_at).toBeNull();
    });

    test('a persisted expired claim is recoverable after worker death', async () => {
      await sql`UPDATE feed_poll_state SET refresh_token = ${randomUUID()}, refresh_expires_at = now() - interval '1 second'`;
      expect(await getDuePodcasts(sql, 10)).toEqual([{ id: podcastId }]);
      expect(await refreshFeed(sql, podcastId, 'scheduled')).toBe('updated');
      expect(await title()).toBe('Fetched');
      expect((await state()).refresh_token).toBeNull();
    });

    test.each([
      true,
      false,
    ])('stale completion (success=%s) cannot overwrite or release a newer worker claim', async (success) => {
      const old = await pause(success);
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let replacement: Promise<unknown> | undefined;
      try {
        await observer`UPDATE feed_poll_state SET refresh_expires_at = now() - interval '1 second'`;
        respond = async () => {
          started.resolve();
          await release.promise;
          return new Response(feed('Replacement'));
        };
        replacement = refreshFeed(observer, podcastId, 'scheduled');
        await started.promise;
        const newer = await state();
        old.release();
        expect(await old.result).toBe('skipped');
        expect((await state()).refresh_token).toBe(newer.refresh_token);
        expect((await state()).failures).toBe(0);
        expect(await title()).toBe('Cached');
      } finally {
        old.release();
        release.resolve();
        await old.result;
        await replacement;
      }
      expect(await title()).toBe('Replacement');
      expect((await state()).refresh_token).toBeNull();
    });

    test('expiry without a replacement also refuses publication', async () => {
      const pending = await pause();
      try {
        await observer`UPDATE feed_poll_state SET refresh_expires_at = now() - interval '1 second'`;
      } finally {
        pending.release();
      }
      expect(await pending.result).toBe('skipped');
      expect(await title()).toBe('Cached');
      expect((await state()).refresh_token).toBeNull();
      expect(await getDuePodcasts(observer, 10)).toEqual([{ id: podcastId }]);
    });

    test.each([
      'locator',
      'owner',
      'locator-round-trip',
    ])('invalidates fetched results on a %s change', async (kind) => {
      const pending = await pause();
      try {
        if (kind === 'owner')
          await observer`UPDATE podcasts SET owner_user_id = 'owner' WHERE id = ${podcastId}`;
        else {
          await observer`UPDATE podcasts SET feed_url = ${new URL('/changed', server.url).href} WHERE id = ${podcastId}`;
          if (kind === 'locator-round-trip')
            await observer`UPDATE podcasts SET feed_url = ${server.url.href} WHERE id = ${podcastId}`;
        }
      } finally {
        pending.release();
      }
      expect(await pending.result).toBe('skipped');
      expect(await title()).toBe('Cached');
      expect(await observer`SELECT id FROM episodes`).toHaveLength(0);
      expect((await state()).refresh_token).toBeNull();
    });

    test('account deletion during fetch cannot recreate private metadata or poll state', async () => {
      await sql`UPDATE podcasts SET owner_user_id = 'owner' WHERE id = ${podcastId}`;
      const pending = await pause();
      try {
        await observer`DELETE FROM users WHERE id = 'owner'`;
      } finally {
        pending.release();
      }
      expect(await pending.result).toBe('not_found');
      expect(await observer`SELECT id FROM podcasts`).toHaveLength(0);
      expect(await observer`SELECT id FROM episodes`).toHaveLength(0);
      expect(await observer`SELECT * FROM feed_poll_state`).toHaveLength(0);
    });

    test('an invalidated failed request does not back off the replacement locator', async () => {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      respond = async () => {
        started.resolve();
        await release.promise;
        return new Response(null, { status: 503 });
      };
      const pending = refreshFeed(sql, podcastId, 'scheduled');
      await started.promise;
      try {
        await observer`UPDATE podcasts SET feed_url = ${new URL('/replacement', server.url).href} WHERE id = ${podcastId}`;
      } finally {
        release.resolve();
      }
      expect(await pending).toBe('skipped');
      expect((await state()).failures).toBe(0);
      expect(await getDuePodcasts(observer, 10)).toEqual([{ id: podcastId }]);
    });
  },
);
