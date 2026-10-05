import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  type CatalogPodcast,
  insertCatalogPodcasts,
  storeCatalogPodcast,
} from '../src/server/ingest/catalog';
import { storeTopPodcasts } from '../src/server/ingest/charts';
import { registerPublicAliases } from '../src/server/ingest/feed-aliases';
import { refreshFeed } from '../src/server/ingest/feed-refresh';
import {
  findPodcastIdentity,
  indexPodcast,
  indexPrivatePodcast,
  PodcastAccessDenied,
  PodcastIdentityConflict,
} from '../src/server/ingest/index-podcast';
import { resolvePublicFeedMove } from '../src/server/ingest/public-feed-moves';
import { searchPodcastsByFeedUrl } from '../src/server/search';
import { parseAliasPlan, runAliasPlan } from './feed-aliases';
import { readProtected } from './lib/artifacts';
import { startPostgres } from './lib/postgres-sandbox';
import { createSchemaFixture } from './lib/schema-fixture';

const canonical = 'https://feeds.example.invalid/current';
const old = 'http://feeds.example.invalid/old';
const xml = readFileSync(
  new URL('../src/server/ingest/__fixtures__/refresh.xml', import.meta.url),
  'utf8',
);
const claim = {
  podcastId: 1,
  expectedFeedUrl: canonical,
  aliases: [old],
  evidence: { type: 'reviewed' as const, reference: 'synthetic-review' },
};

describe('public alias plan validation', () => {
  test.each([
    null,
    {},
    { claims: [] },
    { claims: Array(101).fill(claim) },
  ])('rejects malformed or unbounded plans', (input) => {
    expect(() => parseAliasPlan(input)).toThrow();
  });
  test('rejects unsafe locators before database work', () => {
    expect(() =>
      parseAliasPlan({ claims: [{ ...claim, aliases: ['file:///tmp/feed'] }] }),
    ).toThrow();
    expect(() =>
      parseAliasPlan({
        claims: [
          {
            ...claim,
            expectedFeedUrl: 'https://name:secret@example.invalid/rss',
          },
        ],
      }),
    ).toThrow();
  });
  test('CLI refuses app database fallback without an explicit alias target', () => {
    const child = Bun.spawnSync(
      [
        process.execPath,
        new URL('./feed-aliases.ts', import.meta.url).pathname,
        'review',
        '/missing/plan.json',
        '/missing/receipt.json',
      ],
      {
        env: {
          ...process.env,
          ALIAS_DATABASE_URL: '',
          DATABASE_URL: 'postgres://must-not-be-used.invalid/app',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    expect(child.exitCode).toBe(1);
    expect(child.stderr.toString()).not.toContain('must-not-be-used');
  });
});

describe.skipIf(!process.env.PG_BIN)(
  'public feed aliases on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let server: ReturnType<typeof Bun.serve>;
    beforeAll(() => {
      cluster = startPostgres();
      sql = cluster.sql;
      server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: (request) =>
          new URL(request.url).pathname === '/old'
            ? new Response(null, { status: 301, headers: { location: '/new' } })
            : new Response(xml),
      });
    });
    afterAll(async () => {
      server?.stop(true);
      await cluster?.stop();
    });
    beforeEach(async () => {
      await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      await createSchemaFixture(sql);
      await sql`INSERT INTO users(id,email) VALUES ('owner','owner@example.invalid'),('other','other@example.invalid')`;
      await sql`INSERT INTO authors(id,name) VALUES (1,'Synthetic publisher')`;
      await sql`INSERT INTO podcasts(id,title,feed_url,author_id,cover,itunes_id) VALUES (1,'Public',${canonical},1,'art',101)`;
      await sql`SELECT setval(pg_get_serial_sequence('podcasts','id'),100)`;
      await sql`SELECT setval(pg_get_serial_sequence('authors','id'),100)`;
    });

    test('reviewed aliases resolve to canonical data without importing or changing ownership', async () => {
      await registerPublicAliases(sql, claim);
      expect(await indexPrivatePodcast(sql, old, 'owner')).toBe(1);
      expect(await indexPrivatePodcast(sql, old, 'other')).toBe(1);
      expect(await indexPodcast(sql, old, 101)).toBe(1);
      expect(await searchPodcastsByFeedUrl(sql, old)).toMatchObject({
        id: 1,
        feed: canonical,
        isPrivate: false,
      });
      expect((await sql`SELECT count(*)::int AS n FROM podcasts`)[0].n).toBe(1);
    });

    test('does not guess scheme, path or credential equivalence', async () => {
      expect(
        await findPodcastIdentity(sql, canonical.replace('https:', 'http:')),
      ).toBeUndefined();
      expect(await findPodcastIdentity(sql, `${canonical}/`)).toBeUndefined();
      expect(
        await findPodcastIdentity(sql, `${canonical}?token=synthetic`),
      ).toBeUndefined();
    });

    test('a canonical move preserves identity, history and validator safety', async () => {
      await sql`INSERT INTO episodes(id,podcast_id,guid,published) VALUES (1,1,'episode',now())`;
      await sql`INSERT INTO playback_progress(user_id,episode_id,position) VALUES ('owner',1,123)`;
      await sql`INSERT INTO feed_poll_state(podcast_id,etag,hash) VALUES (1,'old-validator','old-hash')`;
      const next = 'https://publisher.example.invalid/new';
      await registerPublicAliases(sql, { ...claim, canonicalFeedUrl: next });
      expect((await findPodcastIdentity(sql, canonical))?.feed_url).toBe(next);
      expect((await findPodcastIdentity(sql, old))?.id).toBe('1');
      expect(
        (await sql`SELECT position FROM playback_progress`)[0].position,
      ).toBe(123);
      expect(
        (await sql`SELECT etag,hash,last_polled_at FROM feed_poll_state`)[0],
      ).toEqual({ etag: null, hash: null, last_polled_at: null });
      expect(
        (
          await sql`SELECT count(*)::int AS n FROM podcast_feed_aliases WHERE feed_url=${next}`
        )[0].n,
      ).toBe(0);
    });

    test('private sources cannot gain public aliases or be published through another alias', async () => {
      const privateUrl =
        'https://feeds.example.invalid/private?token=synthetic';
      await sql`INSERT INTO podcasts(id,title,feed_url,author_id,cover,owner_user_id) VALUES (2,'Private',${privateUrl},1,'art','owner')`;
      await expect(
        registerPublicAliases(sql, {
          ...claim,
          podcastId: 2,
          expectedFeedUrl: privateUrl,
        }),
      ).rejects.toBeInstanceOf(PodcastAccessDenied);
      await expect(
        registerPublicAliases(sql, { ...claim, aliases: [privateUrl] }),
      ).rejects.toBeInstanceOf(PodcastIdentityConflict);
      await expect(
        indexPrivatePodcast(sql, privateUrl, 'other'),
      ).rejects.toBeInstanceOf(PodcastAccessDenied);
      expect(
        (await sql`SELECT owner_user_id FROM podcasts WHERE id=2`)[0]
          .owner_user_id,
      ).toBe('owner');
      expect(
        (await sql`SELECT count(*)::int AS n FROM podcast_feed_aliases`)[0].n,
      ).toBe(0);
    });

    test('provider and accepted-alias disagreement does not select or merge either source', async () => {
      await registerPublicAliases(sql, claim);
      await sql`INSERT INTO podcasts(id,title,feed_url,author_id,cover,itunes_id) VALUES (2,'Different','https://example.invalid/different',1,'art',202)`;
      await expect(indexPodcast(sql, old, 202)).rejects.toBeInstanceOf(
        PodcastIdentityConflict,
      );
      await expect(
        registerPublicAliases(sql, {
          ...claim,
          aliases: ['https://example.invalid/different'],
        }),
      ).rejects.toBeInstanceOf(PodcastIdentityConflict);
      expect((await sql`SELECT count(*)::int AS n FROM podcasts`)[0].n).toBe(2);
    });

    test('database guards reject bypass writers and private alias targets', async () => {
      await registerPublicAliases(sql, claim);
      await expect(
        sql`INSERT INTO podcasts(title,feed_url,author_id,cover) VALUES ('Duplicate',${old},1,'art')`.execute(),
      ).rejects.toThrow();
      await sql`UPDATE podcasts SET itunes_id=NULL WHERE id=1`;
      await expect(
        sql`UPDATE podcasts SET owner_user_id='owner' WHERE id=1`.execute(),
      ).rejects.toThrow();
      await sql`INSERT INTO podcasts(id,title,feed_url,author_id,cover,owner_user_id) VALUES (2,'Private','https://example.invalid/private',1,'art','owner')`;
      await expect(
        sql`INSERT INTO podcast_feed_aliases(feed_url,podcast_id,evidence_type,evidence_reference) VALUES ('https://example.invalid/unsafe',2,'reviewed','fixture')`.execute(),
      ).rejects.toThrow();
    });

    test('concurrent claims for different sources cannot steal an alias', async () => {
      await sql`INSERT INTO podcasts(id,title,feed_url,author_id,cover) VALUES (2,'Second','https://example.invalid/second',1,'art')`;
      const other = postgres(cluster.options);
      try {
        const results = await Promise.allSettled([
          registerPublicAliases(sql, claim),
          registerPublicAliases(other, {
            ...claim,
            podcastId: 2,
            expectedFeedUrl: 'https://example.invalid/second',
          }),
        ]);
        expect(
          results.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        expect(
          results.filter((result) => result.status === 'rejected'),
        ).toHaveLength(1);
        expect(
          (
            await sql`SELECT count(*)::int AS n FROM podcast_feed_aliases WHERE feed_url=${old}`
          )[0].n,
        ).toBe(1);
      } finally {
        await other.end();
      }
    });

    test('concurrent permanent alias and destination imports converge', async () => {
      const from = new URL('/old', server.url).href;
      const to = new URL('/new', server.url).href;
      const verify = async () => ({
        status: 'verified' as const,
        evidence: {
          requestedUrl: from,
          canonicalFeedUrl: to,
          aliases: [from, to],
          reference: 'synthetic-network-proof',
        },
      });
      const other = postgres(cluster.options);
      try {
        const ids = await Promise.all([
          indexPodcast(sql, from, undefined, verify),
          indexPodcast(other, to),
        ]);
        expect(new Set(ids).size).toBe(1);
        expect((await findPodcastIdentity(sql, from))?.feed_url).toBe(to);
        expect((await sql`SELECT count(*)::int AS n FROM podcasts`)[0].n).toBe(
          2,
        );
      } finally {
        await other.end();
      }
    });

    test('an observed destination alias cannot downgrade a newer canonical choice', async () => {
      const from = new URL('/old', server.url).href;
      const to = new URL('/new', server.url).href;
      const latest = new URL('/latest', server.url).href;
      await sql`UPDATE podcasts SET feed_url=${to} WHERE id=1`;
      const id = await indexPodcast(sql, from, undefined, async () => {
        await registerPublicAliases(sql, {
          ...claim,
          expectedFeedUrl: to,
          canonicalFeedUrl: latest,
          aliases: [to],
        });
        return {
          status: 'verified',
          evidence: {
            requestedUrl: from,
            canonicalFeedUrl: to,
            aliases: [from, to],
            reference: 'fixture',
          },
        };
      });
      expect(id).toBe(1);
      expect((await findPodcastIdentity(sql, from))?.feed_url).toBe(latest);
    });

    test('refresh verifies public moves only after releasing its transaction', async () => {
      const from = new URL('/old', server.url).href;
      const to = new URL('/new', server.url).href;
      await sql`UPDATE podcasts SET feed_url=${from} WHERE id=1`;
      const other = postgres(cluster.options);
      let called = false;
      try {
        expect(
          await refreshFeed(sql, 1, 'rebuild', async (database, id) => {
            called = true;
            await other.begin(async (tx) => {
              expect(
                (
                  await tx`SELECT pg_try_advisory_xact_lock(1::bigint) AS acquired`
                )[0].acquired,
              ).toBe(true);
            });
            return resolvePublicFeedMove(database, id, async () => ({
              status: 'verified',
              evidence: {
                requestedUrl: from,
                canonicalFeedUrl: to,
                aliases: [from, to],
                reference: 'fixture',
              },
            }));
          }),
        ).toBe('updated');
        expect(called).toBe(true);
        expect((await findPodcastIdentity(sql, from))?.feed_url).toBe(to);
      } finally {
        await other.end();
      }
    });

    test('a canonical move defers while refresh owns the source validators', async () => {
      const target = 'https://publisher.example.invalid/new';
      const verify = async () => ({
        status: 'verified' as const,
        evidence: {
          requestedUrl: canonical,
          canonicalFeedUrl: target,
          aliases: [canonical, target],
          reference: 'fixture',
        },
      });
      const other = postgres(cluster.options);
      try {
        await other.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(1::bigint)`;
          expect(await resolvePublicFeedMove(sql, 1, verify)).toEqual({
            status: 'verification_pending',
            reason: 'source_busy',
          });
          expect(
            (await sql`SELECT feed_url FROM podcasts WHERE id=1`)[0].feed_url,
          ).toBe(canonical);
        });
        expect(await resolvePublicFeedMove(sql, 1, verify)).toEqual({
          status: 'resolved',
          podcastId: 1,
        });
      } finally {
        await other.end();
      }
    });

    test('private redirect refresh never requests public alias verification', async () => {
      const id = await indexPrivatePodcast(
        sql,
        new URL('/old', server.url).href,
        'owner',
      );
      let called = false;
      expect(
        await refreshFeed(sql, id, 'rebuild', async () => {
          called = true;
          return { status: 'unavailable' };
        }),
      ).toBe('updated');
      expect(called).toBe(false);
      expect(
        (await sql`SELECT count(*)::int AS n FROM podcast_feed_aliases`)[0].n,
      ).toBe(0);
    });

    test('verified moves refuse existing targets and stale observations', async () => {
      const target = 'https://example.invalid/target';
      await sql`INSERT INTO podcasts(id,title,feed_url,author_id,cover) VALUES (2,'Target',${target},1,'art')`;
      const verify = async () => ({
        status: 'verified' as const,
        evidence: {
          requestedUrl: canonical,
          canonicalFeedUrl: target,
          aliases: [canonical, target],
          reference: 'fixture',
        },
      });
      expect(await resolvePublicFeedMove(sql, 1, verify)).toEqual({
        status: 'identity_conflict',
      });
      await sql`DELETE FROM podcasts WHERE id=2`;
      expect(
        await resolvePublicFeedMove(sql, 1, async () => {
          await sql`UPDATE podcasts SET feed_url='https://example.invalid/changed' WHERE id=1`;
          return verify();
        }),
      ).toEqual({ status: 'identity_conflict' });
    });

    const catalog = (feed = old): CatalogPodcast => ({
      podcastIndexId: 400,
      itunesId: 101,
      feed,
      authorId: 1,
      title: 'Public metadata',
      description: null,
      cover: 'art',
      website: null,
      explicit: false,
      episodeCount: 0,
      lastPublished: null,
      active: true,
      language: null,
      popularity: null,
      priority: null,
      updateFrequency: null,
    });

    test('catalog updates and insert-only patches reuse aliases without downgrading canonical URLs', async () => {
      await registerPublicAliases(sql, claim);
      expect(await storeCatalogPodcast(sql, catalog())).toBe('updated');
      expect(await storeCatalogPodcast(sql, catalog(), true)).toBe('skipped');
      expect(
        (
          await sql`SELECT feed_url,podcast_index_id FROM podcasts WHERE id=1`
        )[0],
      ).toEqual({ feed_url: canonical, podcast_index_id: 400 });
      expect(
        await storeCatalogPodcast(
          sql,
          catalog('https://example.invalid/unverified-new-locator'),
        ),
      ).toBe('updated');
      expect(
        (await sql`SELECT feed_url FROM podcasts WHERE id=1`)[0].feed_url,
      ).toBe(canonical);
      expect(
        await findPodcastIdentity(
          sql,
          'https://example.invalid/unverified-new-locator',
        ),
      ).toBeUndefined();
    });

    test('bounded catalog insertion skips both accepted aliases and private exact sources', async () => {
      await registerPublicAliases(sql, claim);
      await sql`INSERT INTO podcasts(id,title,feed_url,author_id,cover,owner_user_id) VALUES (2,'Private','https://example.invalid/private',1,'art','owner')`;
      const rows = [
        { ...catalog(), itunesId: null },
        {
          ...catalog('https://example.invalid/private'),
          podcastIndexId: 401,
          itunesId: null,
        },
        {
          ...catalog('https://example.invalid/new'),
          podcastIndexId: 402,
          itunesId: null,
        },
      ];
      expect(await insertCatalogPodcasts(sql, rows)).toBe(1);
      expect(await insertCatalogPodcasts(sql, rows)).toBe(0);
      expect((await sql`SELECT count(*)::int AS n FROM podcasts`)[0].n).toBe(3);
      expect(
        (await sql`SELECT owner_user_id FROM podcasts WHERE id=2`)[0]
          .owner_user_id,
      ).toBe('owner');
    });

    test('catalog writers reject private sources and conflicting established provider identities', async () => {
      await sql`INSERT INTO podcasts(id,title,feed_url,author_id,cover,owner_user_id) VALUES (2,'Private','https://example.invalid/private',1,'art','owner')`;
      await expect(
        storeCatalogPodcast(sql, {
          ...catalog('https://example.invalid/private'),
          itunesId: null,
        }),
      ).rejects.toBeInstanceOf(PodcastAccessDenied);
      await registerPublicAliases(sql, claim);
      await storeCatalogPodcast(sql, catalog());
      await expect(
        storeCatalogPodcast(sql, { ...catalog(), podcastIndexId: 401 }),
      ).rejects.toBeInstanceOf(PodcastIdentityConflict);
    });

    test('charts retain canonical identity when Apple returns an accepted historical URL', async () => {
      await registerPublicAliases(sql, claim);
      await storeTopPodcasts(
        sql,
        [
          {
            itunesId: 101,
            author: 'Publisher',
            feed: old,
            title: 'Public',
            verifiedAt: new Date().toISOString(),
            cover: 'art',
            thumbnail: null,
            explicit: false,
            genres: [],
            count: 0,
            rank: 1,
          },
        ],
        'us',
      );
      expect(
        (await sql`SELECT podcast_id FROM top_podcasts`)[0].podcast_id,
      ).toBe('1');
      expect(
        (await sql`SELECT feed_url FROM podcasts WHERE id=1`)[0].feed_url,
      ).toBe(canonical);
    });

    test('operator plans rehearse with protected backups before an explicit apply', async () => {
      const review = join(cluster.directory, 'alias-review.json');
      expect(await runAliasPlan(sql, [claim], review)).toMatchObject({
        status: 'rolled_back',
      });
      expect(
        (await sql`SELECT count(*)::int AS n FROM podcast_feed_aliases`)[0].n,
      ).toBe(0);
      expect(typeof readProtected(review).before.sources[0].created_at).toBe(
        'string',
      );
      await expect(runAliasPlan(sql, [claim], review, true)).rejects.toThrow();
      expect(
        (await sql`SELECT count(*)::int AS n FROM podcast_feed_aliases`)[0].n,
      ).toBe(0);
      expect(
        await runAliasPlan(
          sql,
          [claim],
          join(cluster.directory, 'alias-apply.json'),
          true,
        ),
      ).toMatchObject({ status: 'committed' });
      expect(
        (await sql`SELECT count(*)::int AS n FROM podcast_feed_aliases`)[0].n,
      ).toBe(1);
    });

    test('a conflicting reviewed batch rolls back every alias', async () => {
      await sql`INSERT INTO podcasts(id,title,feed_url,author_id,cover) VALUES (2,'Second','https://example.invalid/second',1,'art')`;
      await expect(
        runAliasPlan(
          sql,
          [
            claim,
            {
              ...claim,
              podcastId: 2,
              expectedFeedUrl: 'https://example.invalid/second',
            },
          ],
          join(cluster.directory, 'conflicting-plan.json'),
          true,
        ),
      ).rejects.toBeInstanceOf(PodcastIdentityConflict);
      expect(
        (await sql`SELECT count(*)::int AS n FROM podcast_feed_aliases`)[0].n,
      ).toBe(0);
    });

    test('verified association through an accepted public alias preserves canonical choice', async () => {
      await sql`UPDATE podcasts SET itunes_id=NULL WHERE id=1`;
      await registerPublicAliases(sql, claim);
      expect(await indexPodcast(sql, old, 101)).toBe(1);
      expect(
        (await sql`SELECT feed_url,itunes_id FROM podcasts WHERE id=1`)[0],
      ).toEqual({ feed_url: canonical, itunes_id: '101' });
    });
  },
);
