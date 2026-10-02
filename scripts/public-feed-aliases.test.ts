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
import { registerPublicAliases } from '../src/server/ingest/feed-aliases';
import {
  findPodcastIdentity,
  indexPodcast,
  indexPrivatePodcast,
  PodcastAccessDenied,
  PodcastIdentityConflict,
} from '../src/server/ingest/index-podcast';
import { resolvePublicFeedMove } from '../src/server/ingest/public-feed-moves';
import { searchPodcastsByFeedUrl } from '../src/server/search';
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
