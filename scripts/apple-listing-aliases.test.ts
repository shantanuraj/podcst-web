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
import { storeCatalogPodcast } from '../src/server/ingest/catalog';
import {
  type ChartPodcast,
  storeTopPodcasts,
} from '../src/server/ingest/charts';
import { indexPodcast } from '../src/server/ingest/index-podcast';
import {
  claimPublicIdentity,
  findPodcastIdentity,
} from '../src/server/ingest/podcast-identity';
import { resolvePodcast } from '../src/server/ingest/resolve-podcast';
import { matchSearchResults } from '../src/server/search';
import { startPostgres } from './lib/postgres-sandbox';
import { createSchemaFixture } from './lib/schema-fixture';

const feed = 'https://example.invalid/a';
const otherFeed = 'https://example.invalid/b';
const verification = () => ({
  country: 'us',
  verifiedAt: new Date().toISOString(),
});
const listing = (itunesId: number, url = feed) =>
  mock(async () =>
    Response.json({
      results: [{ kind: 'podcast', collectionId: itunesId, feedUrl: url }],
    }),
  );
const chart = (itunesId: number, rank: number, url = feed): ChartPodcast => ({
  itunesId,
  rank,
  feed: url,
  title: 'Synthetic',
  author: 'Publisher',
  cover: '',
  thumbnail: null,
  explicit: false,
  count: 0,
  verifiedAt: new Date().toISOString(),
});

describe.skipIf(!process.env.PG_BIN)('verified Apple listing aliases', () => {
  let cluster: ReturnType<typeof startPostgres>;
  beforeAll(async () => {
    cluster = startPostgres();
    await createSchemaFixture(cluster.sql);
  }, 30_000);
  afterAll(async () => {
    await cluster?.stop();
  });
  beforeEach(async () => {
    const sql = cluster.sql;
    await sql`TRUNCATE podcasts, authors, users, countries, genres RESTART IDENTITY CASCADE`;
    await sql`INSERT INTO users (id,email) VALUES ('owner','owner@example.invalid')`;
    await sql`INSERT INTO authors (id,name) VALUES (1,'Publisher')`;
    await sql`INSERT INTO podcasts (id,itunes_id,feed_url,title,author_id,cover) VALUES
      (1,101,${feed},'Public',1,''),(2,202,${otherFeed},'Other',1,'')`;
    await sql`INSERT INTO podcasts (id,owner_user_id,feed_url,title,author_id,cover) VALUES
      (3,'owner','https://example.invalid/private','Private',1,'')`;
  });

  test('trusted lookup adds a secondary listing without replacing the source or preferred ID', async () => {
    const sql = cluster.sql;
    expect(await resolvePodcast(sql, 303, 'us', listing(303))).toBe(1);
    const [source] = await sql`SELECT itunes_id::text FROM podcasts WHERE id=1`;
    expect(source.itunes_id).toBe('101');
    const [alias] =
      await sql`SELECT * FROM podcast_apple_aliases WHERE itunes_id=303`;
    expect(alias.podcast_id).toBe('1');
    expect(alias.evidence_type).toBe('apple_lookup');
    expect(alias.evidence).toMatchObject({
      feedUrl: feed,
      country: 'us',
    });
    expect(alias.evidence_reference).toMatch(/^[a-f0-9]{64}$/);
    const unavailable = mock(async () => {
      throw new Error('No network needed');
    });
    expect(await resolvePodcast(sql, 303, 'us', unavailable)).toBe(1);
    expect(unavailable).not.toHaveBeenCalled();
    expect((await findPodcastIdentity(sql, feed, 303))?.id).toBe('1');
    const results = await matchSearchResults(sql, [
      {
        itunes_id: 303,
        title: 'Listing',
        author: 'Publisher',
        feed: 'https://example.invalid/old',
        cover: '',
        thumbnail: '',
      },
    ]);
    expect(results[0]).toMatchObject({ id: 1, itunes_id: 303, feed });
  });

  test('search presents one result per established source without claiming unknown listings', async () => {
    const sql = cluster.sql;
    await resolvePodcast(sql, 303, 'us', listing(303));
    const results = await matchSearchResults(
      sql,
      [303, 101, 999].map((itunes_id) => ({
        itunes_id,
        title: 'Synthetic',
        author: 'Publisher',
        feed,
        cover: '',
        thumbnail: '',
      })),
    );
    expect(results.map((p) => ({ id: p.id, itunesId: p.itunes_id }))).toEqual([
      { id: 1, itunesId: 303 },
      { id: undefined, itunesId: 999 },
    ]);
    expect(
      (await sql`SELECT count(*)::int AS n FROM podcast_apple_aliases`)[0].n,
    ).toBe(1);
  });

  test('unverified imports cannot invent a secondary Apple association', async () => {
    await expect(indexPodcast(cluster.sql, feed, 303)).rejects.toThrow(
      'verification required',
    );
    const [count] =
      await cluster.sql`SELECT count(*)::int AS n FROM podcast_apple_aliases`;
    expect(count.n).toBe(0);
  });

  test('catalog hints may reuse accepted listings but cannot establish new aliases', async () => {
    const sql = cluster.sql;
    const input = {
      podcastIndexId: 501,
      itunesId: 303,
      feed,
      authorId: 1,
      title: 'Public',
      description: null,
      cover: '',
      website: null,
      explicit: false,
      episodeCount: 0,
      lastPublished: null,
      active: true,
      language: null,
      popularity: null,
      priority: null,
      updateFrequency: null,
    };
    await expect(storeCatalogPodcast(sql, input)).rejects.toThrow(
      'verification required',
    );
    await resolvePodcast(sql, 303, 'us', listing(303));
    expect(await storeCatalogPodcast(sql, input)).toBe('updated');
    expect(
      (
        await sql`SELECT itunes_id::text,podcast_index_id FROM podcasts WHERE id=1`
      )[0],
    ).toEqual({ itunes_id: '101', podcast_index_id: 501 });
  });

  test('secondary claims reject expired, future and malformed verification', async () => {
    for (const v of [
      { country: 'us', verifiedAt: 'invalid' },
      {
        country: 'us',
        verifiedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      },
      {
        country: 'us',
        verifiedAt: new Date(Date.now() + 60 * 1000).toISOString(),
      },
      { country: 'invalid', verifiedAt: new Date().toISOString() },
    ])
      await expect(
        indexPodcast(cluster.sql, feed, 303, undefined, v),
      ).rejects.toThrow('verification required');
  });

  test('verification must identify the same public locator', async () => {
    const sql = cluster.sql;
    const source = await findPodcastIdentity(sql, feed);
    if (!source) throw new Error('Fixture missing');
    await expect(
      sql.begin((tx) =>
        claimPublicIdentity(
          tx,
          source,
          'https://example.invalid/unrelated',
          303,
          verification(),
        ),
      ),
    ).rejects.toThrow('does not identify this public source');
  });

  test('Apple lookup preserves the exact locator rather than adding a trailing slash', async () => {
    const sql = cluster.sql;
    const exact = 'https://example.invalid';
    await sql`UPDATE podcasts SET feed_url=${exact} WHERE id=1`;
    expect(await resolvePodcast(sql, 303, 'us', listing(303, exact))).toBe(1);
    expect(
      (
        await sql`SELECT evidence FROM podcast_apple_aliases WHERE itunes_id=303`
      )[0].evidence.feedUrl,
    ).toBe(exact);
  });

  test('accepted feed aliases can establish verified secondary listings', async () => {
    const sql = cluster.sql;
    const old = 'https://example.invalid/accepted';
    await sql`INSERT INTO podcast_feed_aliases (feed_url,podcast_id,evidence_type,evidence_reference) VALUES (${old},1,'reviewed','fixture')`;
    expect(await resolvePodcast(sql, 303, 'us', listing(303, old))).toBe(1);
    expect(
      (await sql`SELECT feed_url FROM podcasts WHERE id=1`)[0].feed_url,
    ).toBe(feed);
  });

  test('existing records are never merged when a feed and provider disagree', async () => {
    const sql = cluster.sql;
    await expect(
      indexPodcast(sql, feed, 202, undefined, verification()),
    ).rejects.toThrow('different podcasts');
    await resolvePodcast(sql, 303, 'us', listing(303));
    await expect(
      indexPodcast(sql, otherFeed, 303, undefined, verification()),
    ).rejects.toThrow('different podcasts');
    expect((await sql`SELECT count(*)::int AS n FROM podcasts`)[0].n).toBe(3);
  });

  test('database guards reject private targets, duplicate identities and reassignment', async () => {
    const sql = cluster.sql;
    await expect(
      sql`INSERT INTO podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (303,3,'reviewed','fixture')`.execute(),
    ).rejects.toThrow('must be public');
    await expect(
      sql`INSERT INTO podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (101,1,'reviewed','fixture')`.execute(),
    ).rejects.toThrow('preferred listing');
    await resolvePodcast(sql, 303, 'us', listing(303));
    await expect(
      sql`UPDATE podcast_apple_aliases SET podcast_id=2 WHERE itunes_id=303`.execute(),
    ).rejects.toThrow('requires reconciliation');
    await expect(
      sql`UPDATE podcasts SET itunes_id=303 WHERE id=2`.execute(),
    ).rejects.toThrow('accepted alias');
    await expect(
      sql`UPDATE podcasts SET itunes_id=NULL WHERE id=1`.execute(),
    ).rejects.toThrow('source eligibility');
    await expect(
      sql`UPDATE podcasts SET itunes_id=NULL,owner_user_id='owner' WHERE id=1`.execute(),
    ).rejects.toThrow('source eligibility');
  });

  test('new identity guards cannot be bypassed with repeatable-read snapshots', async () => {
    const sql = cluster.sql;
    for (const mutation of [
      (tx: postgres.TransactionSql) =>
        tx`INSERT INTO podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (303,1,'reviewed','fixture')`,
      (tx: postgres.TransactionSql) =>
        tx`UPDATE podcasts SET itunes_id=303 WHERE id=2`,
      (tx: postgres.TransactionSql) =>
        tx`UPDATE podcasts SET itunes_id=NULL,owner_user_id='owner' WHERE id=1`,
    ])
      await expect(
        sql.begin('isolation level repeatable read', async (tx) => {
          await mutation(tx);
        }),
      ).rejects.toThrow('read committed');
  });

  test('temporary tables cannot shadow Apple ownership or identity checks', async () => {
    const sql = cluster.sql;
    await resolvePodcast(sql, 303, 'us', listing(303));
    await sql.begin(async (tx) => {
      await tx.unsafe(`CREATE TEMP TABLE podcasts (id bigint,owner_user_id text,itunes_id bigint) ON COMMIT DROP;
        INSERT INTO pg_temp.podcasts VALUES (3,NULL,999);
        CREATE TEMP TABLE podcast_apple_aliases (itunes_id bigint,podcast_id bigint) ON COMMIT DROP;`);
      await expect(
        tx.savepoint(async (sp) => {
          await sp`INSERT INTO public.podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (404,3,'reviewed','fixture')`;
        }),
      ).rejects.toThrow('must be public');
      await expect(
        tx.savepoint(async (sp) => {
          await sp`UPDATE public.podcasts SET itunes_id=303 WHERE id=2`;
        }),
      ).rejects.toThrow('accepted alias');
    });
  });

  test('concurrent secondary claims cannot bind an Apple ID to two sources', async () => {
    const sql = cluster.sql;
    const other = postgres(cluster.options);
    try {
      await other`SELECT 1`;
      const results = await Promise.allSettled([
        indexPodcast(sql, feed, 303, undefined, verification()),
        indexPodcast(other, otherFeed, 303, undefined, verification()),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    } finally {
      await other.end();
    }
    expect(
      (
        await sql`SELECT count(*)::int AS n FROM podcast_apple_aliases WHERE itunes_id=303`
      )[0].n,
    ).toBe(1);
  });

  test('concurrent primary and alias writes share one identity namespace', async () => {
    const sql = cluster.sql;
    const other = postgres(cluster.options);
    try {
      await other`SELECT 1`;
      const results = await Promise.allSettled([
        sql`INSERT INTO podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (303,1,'reviewed','fixture')`.execute(),
        other`INSERT INTO podcasts (id,itunes_id,feed_url,title,author_id,cover) VALUES (4,303,'https://example.invalid/new','New',1,'')`.execute(),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    } finally {
      await other.end();
    }
    const [count] =
      await sql`SELECT (SELECT count(*) FROM podcasts WHERE itunes_id=303)+(SELECT count(*) FROM podcast_apple_aliases WHERE itunes_id=303) AS n`;
    expect(Number(count.n)).toBe(1);
  });

  test('concurrent alias admission and privatization cannot leave a private alias', async () => {
    const sql = cluster.sql;
    const other = postgres(cluster.options);
    try {
      await other`SELECT 1`;
      const results = await Promise.allSettled([
        sql`INSERT INTO podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (303,1,'reviewed','fixture')`.execute(),
        other`UPDATE podcasts SET itunes_id=NULL,owner_user_id='owner' WHERE id=1`.execute(),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(
        (
          await sql`SELECT count(*)::int AS n FROM podcast_apple_aliases a JOIN podcasts p ON p.id=a.podcast_id WHERE p.owner_user_id IS NOT NULL`
        )[0].n,
      ).toBe(0);
    } finally {
      await other.end();
    }
  });

  test('charts retain the highest source rank while registering both listings', async () => {
    const sql = cluster.sql;
    expect(
      await storeTopPodcasts(
        sql,
        [chart(303, 2), chart(101, 1), chart(202, 3, otherFeed)],
        'us',
      ),
    ).toEqual({ stored: 2, newPodcasts: 0 });
    expect(
      Array.from(
        await sql`SELECT rank,podcast_id::text FROM top_podcasts ORDER BY rank`,
      ),
    ).toEqual([
      { rank: 1, podcast_id: '1' },
      { rank: 3, podcast_id: '2' },
    ]);
    expect(
      (
        await sql`SELECT podcast_id FROM podcast_apple_aliases WHERE itunes_id=303`
      )[0].podcast_id,
    ).toBe('1');
  });

  test('a failed country transaction also rolls back new listing aliases', async () => {
    const sql = cluster.sql;
    await expect(
      storeTopPodcasts(sql, [chart(303, 1), chart(202, 1, otherFeed)], 'us'),
    ).rejects.toThrow('duplicate key');
    expect(
      (await sql`SELECT count(*)::int AS n FROM podcast_apple_aliases`)[0].n,
    ).toBe(0);
    expect((await sql`SELECT count(*)::int AS n FROM top_podcasts`)[0].n).toBe(
      0,
    );
  });

  test('deleting a source removes its secondary listings', async () => {
    const sql = cluster.sql;
    await resolvePodcast(sql, 303, 'us', listing(303));
    await sql`DELETE FROM podcasts WHERE id=1`;
    expect(
      (await sql`SELECT count(*)::int AS n FROM podcast_apple_aliases`)[0].n,
    ).toBe(0);
  });
});
