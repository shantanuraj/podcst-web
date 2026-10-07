import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { storeTopPodcasts } from '../src/server/ingest/charts';
import { refreshFeed } from '../src/server/ingest/feed-refresh';
import {
  claimPublicIdentity,
  findPodcastIdentity,
  indexPodcast,
  indexPrivatePodcast,
  PodcastAccessDenied,
  PodcastIdentityConflict,
} from '../src/server/ingest/index-podcast';
import { resolvePodcast } from '../src/server/ingest/resolve-podcast';
import { canAccessPodcast } from '../src/server/podcast-access';
import {
  matchSearchResults,
  searchPodcastsByFeedUrl,
} from '../src/server/search';
import { installFeedTransportFixture } from './fixtures/feed-transport';
import { startPostgres } from './lib/postgres-sandbox';
import { createSchemaFixture } from './lib/schema-fixture';

installFeedTransportFixture();

const xml = readFileSync(
  new URL('../src/server/ingest/__fixtures__/refresh.xml', import.meta.url),
  'utf8',
);

describe.skipIf(!process.env.PG_BIN)(
  'private podcast ownership on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let server: ReturnType<typeof Bun.serve>;
    let requests = 0;
    const lookup = (id: number, feed: string) => async () =>
      Response.json({
        results: [{ collectionId: id, kind: 'podcast', feedUrl: feed }],
      });

    beforeAll(() => {
      cluster = startPostgres();
      sql = cluster.sql;
      server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: () => {
          requests++;
          return new Response(xml);
        },
      });
    }, 30_000);
    afterAll(async () => {
      server?.stop(true);
      await cluster?.stop();
    });
    beforeEach(async () => {
      await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      await createSchemaFixture(sql);
      await sql`INSERT INTO users (id, email) VALUES ('owner', 'owner@example.invalid'), ('other', 'other@example.invalid')`;
      requests = 0;
    });

    test('API routes enforce session, owner, preview/cache and reference boundaries', async () => {
      const child = Bun.spawn(
        [
          process.execPath,
          new URL('./fixtures/private-podcast-routes.ts', import.meta.url)
            .pathname,
        ],
        {
          env: {
            ...process.env,
            PODCST_TEST_SOCKET: cluster.directory,
            PODCST_TEST_FEED: server.url.href,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
      expect(stdout).toContain(
        'Private route authorization, cache and reference checks passed',
      );
      expect(requests).toBe(1);
    }, 30_000);

    test('unknown URL imports have one owner and no public directory identity', async () => {
      const id = await indexPrivatePodcast(sql, server.url.href, 'owner');
      const [row] =
        await sql`SELECT owner_user_id, itunes_id, cover FROM podcasts WHERE id = ${id}`;
      expect(row.owner_user_id).toBe('owner');
      expect(row.itunes_id).toBeNull();
      expect(row.cover).not.toContain('assets.podcst.app');
      expect(await canAccessPodcast(sql, id)).toBe(false);
      expect(await canAccessPodcast(sql, id, 'other')).toBe(false);
      expect(await canAccessPodcast(sql, id, 'owner')).toBe(true);
      expect(await searchPodcastsByFeedUrl(sql, server.url.href)).toBeNull();
      expect(
        await searchPodcastsByFeedUrl(sql, server.url.href, 'other'),
      ).toBeNull();
      expect(
        await searchPodcastsByFeedUrl(sql, server.url.href, 'owner'),
      ).toMatchObject({ id, isPrivate: true });
    });

    test('another account cannot claim an indexed private URL or trigger a refetch', async () => {
      const id = await indexPrivatePodcast(sql, server.url.href, 'owner');
      const before = requests;
      await expect(
        indexPrivatePodcast(sql, server.url.href, 'other'),
      ).rejects.toBeInstanceOf(PodcastAccessDenied);
      await expect(indexPodcast(sql, server.url.href)).rejects.toBeInstanceOf(
        PodcastAccessDenied,
      );
      expect(requests).toBe(before);
      expect(await indexPrivatePodcast(sql, server.url.href, 'owner')).toBe(id);
      expect((await sql`SELECT count(*)::int AS n FROM podcasts`)[0].n).toBe(1);
    });

    test('concurrent private imports cannot overwrite the winning owner', async () => {
      const second = postgres(cluster.options);
      try {
        const outcomes = await Promise.allSettled([
          indexPrivatePodcast(sql, server.url.href, 'owner'),
          indexPrivatePodcast(second, server.url.href, 'other'),
        ]);
        expect(
          outcomes.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        expect(
          outcomes.filter((result) => result.status === 'rejected'),
        ).toHaveLength(1);
        const [podcast] = await sql`SELECT id, owner_user_id FROM podcasts`;
        expect(['owner', 'other']).toContain(podcast.owner_user_id);
        expect(
          await canAccessPodcast(
            sql,
            Number(podcast.id),
            podcast.owner_user_id,
          ),
        ).toBe(true);
      } finally {
        await second.end();
      }
    });

    test('known public sources are reused without changing ownership', async () => {
      const id = await indexPodcast(sql, server.url.href, 101);
      expect(await indexPrivatePodcast(sql, server.url.href, 'owner')).toBe(id);
      expect(await indexPrivatePodcast(sql, server.url.href, 'other')).toBe(id);
      expect(await canAccessPodcast(sql, id)).toBe(true);
      expect(
        (await sql`SELECT owner_user_id FROM podcasts WHERE id = ${id}`)[0]
          .owner_user_id,
      ).toBeNull();
    });

    test('verified exact Apple URL promotes in place and preserves user references', async () => {
      const id = await indexPrivatePodcast(sql, server.url.href, 'owner');
      const [episode] =
        await sql`SELECT id FROM episodes WHERE podcast_id = ${id} ORDER BY id LIMIT 1`;
      await sql`INSERT INTO subscriptions (user_id, podcast_id) VALUES ('owner', ${id})`;
      await sql`INSERT INTO playback_progress (user_id, episode_id, position) VALUES ('owner', ${episode.id}, 123)`;
      expect(
        await resolvePodcast(sql, 101, 'us', lookup(101, server.url.href)),
      ).toBe(id);
      expect(await canAccessPodcast(sql, id)).toBe(true);
      expect(
        (
          await sql`SELECT itunes_id, owner_user_id FROM podcasts WHERE id = ${id}`
        )[0],
      ).toEqual({ itunes_id: '101', owner_user_id: null });
      expect(
        (await sql`SELECT episode_id, position FROM playback_progress`)[0],
      ).toEqual({ episode_id: episode.id, position: 123 });
      expect(
        (await sql`SELECT podcast_id FROM subscriptions`)[0].podcast_id,
      ).toBe(String(id));
      expect(requests).toBe(1);
    });

    test('a different provider URL or stripped credential does not promote a private feed', async () => {
      const privateURL = new URL('/feed?token=synthetic', server.url).href;
      const id = await indexPrivatePodcast(sql, privateURL, 'owner');
      const publicId = await resolvePodcast(
        sql,
        101,
        'us',
        lookup(101, new URL('/feed', server.url).href),
      );
      expect(publicId).not.toBe(id);
      expect(await canAccessPodcast(sql, id)).toBe(false);
      expect(
        (await sql`SELECT owner_user_id FROM podcasts WHERE id = ${id}`)[0]
          .owner_user_id,
      ).toBe('owner');
    });

    test('provider/URL conflicts fail without merging or promoting private state', async () => {
      const privateId = await indexPrivatePodcast(
        sql,
        server.url.href,
        'owner',
      );
      await indexPodcast(sql, new URL('/public', server.url).href, 101);
      await expect(
        indexPodcast(sql, server.url.href, 101),
      ).rejects.toBeInstanceOf(PodcastIdentityConflict);
      expect(await canAccessPodcast(sql, privateId)).toBe(false);
      expect((await sql`SELECT count(*)::int AS n FROM podcasts`)[0].n).toBe(2);
    });

    test('stale verification cannot publish a changed private locator', async () => {
      const id = await indexPrivatePodcast(sql, server.url.href, 'owner');
      const identity = await findPodcastIdentity(sql, server.url.href);
      if (!identity) throw new Error('Missing private identity');
      await sql`UPDATE podcasts SET feed_url = ${new URL('/rotated?token=new', server.url).href} WHERE id = ${id}`;
      await expect(
        sql.begin((tx) =>
          claimPublicIdentity(tx, identity, server.url.href, 101),
        ),
      ).rejects.toBeInstanceOf(PodcastIdentityConflict);
      expect(await canAccessPodcast(sql, id)).toBe(false);
      expect(
        (await sql`SELECT owner_user_id FROM podcasts WHERE id = ${id}`)[0]
          .owner_user_id,
      ).toBe('owner');
    });

    test('trusted charts promote an exact source without replacing IDs or content', async () => {
      const id = await indexPrivatePodcast(sql, server.url.href, 'owner');
      const episodes = Array.from(
        await sql`SELECT * FROM episodes ORDER BY id`,
      );
      await storeTopPodcasts(
        sql,
        [
          {
            itunesId: 101,
            author: 'Author',
            feed: server.url.href,
            title: 'Public show',
            verifiedAt: new Date().toISOString(),
            cover: 'cover',
            thumbnail: null,
            explicit: false,
            genres: [],
            count: 5,
            rank: 1,
          },
        ],
        'us',
      );
      expect(await canAccessPodcast(sql, id)).toBe(true);
      expect(Array.from(await sql`SELECT * FROM episodes ORDER BY id`)).toEqual(
        episodes,
      );
      expect(
        (await sql`SELECT podcast_id FROM top_podcasts`)[0].podcast_id,
      ).toBe(String(id));
    });

    test('private refresh keeps artwork off the shared proxy', async () => {
      const id = await indexPrivatePodcast(sql, server.url.href, 'owner');
      expect(await refreshFeed(sql, id, 'rebuild')).toBe('updated');
      expect(
        (await sql`SELECT cover FROM podcasts WHERE id = ${id}`)[0].cover,
      ).not.toContain('assets.podcst.app');
    });

    test('deleting an owner deletes its private sources, never makes them public', async () => {
      const privateId = await indexPrivatePodcast(
        sql,
        server.url.href,
        'owner',
      );
      const publicId = await indexPodcast(
        sql,
        new URL('/public', server.url).href,
        101,
      );
      await sql`DELETE FROM users WHERE id = 'owner'`;
      expect(await canAccessPodcast(sql, privateId)).toBe(false);
      expect(
        (
          await sql`SELECT count(*)::int AS n FROM podcasts WHERE id = ${privateId}`
        )[0].n,
      ).toBe(0);
      expect(await canAccessPodcast(sql, publicId)).toBe(true);
    });

    test('unverified provider assignment is rejected unless ownership is cleared atomically', async () => {
      const id = await indexPrivatePodcast(sql, server.url.href, 'owner');
      await expect(
        sql`UPDATE podcasts SET itunes_id = 101 WHERE id = ${id}`.execute(),
      ).rejects.toThrow('podcasts_private_provider_check');
      const identity = await findPodcastIdentity(sql, server.url.href);
      expect(identity).toBeDefined();
      if (!identity) throw new Error('Missing private identity');
      await expect(
        sql.begin((tx) =>
          claimPublicIdentity(
            tx,
            identity,
            new URL('/different', server.url).href,
            101,
          ),
        ),
      ).rejects.toBeInstanceOf(PodcastAccessDenied);
      expect(
        await matchSearchResults(sql, [
          {
            itunes_id: 101,
            title: 'Public',
            feed: 'https://example.invalid/public',
            author: '',
            cover: '',
            thumbnail: '',
          },
        ]),
      ).toEqual([
        {
          itunes_id: 101,
          title: 'Public',
          feed: 'https://example.invalid/public',
          author: '',
          cover: '',
          thumbnail: '',
        },
      ]);
    });
  },
);
