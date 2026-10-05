import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import postgres from 'postgres';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import {
  type AppleIdentityPlan,
  claimAppleIdentity,
  findAppleSource,
  prepareAppleIdentity,
} from './apple-identity';
import { indexPodcast } from './index-podcast';
import { lockPodcastIdentities } from './podcast-identity';
import { resolvePodcast } from './resolve-podcast';

const oldFeed = 'https://example.invalid/old';
const newFeed = 'https://example.invalid/current';
const evidence = (itunesId = 101, feedUrl = newFeed) => ({
  itunesId,
  feedUrl,
  country: 'my',
  verifiedAt: new Date().toISOString(),
});
const lookup =
  (itunesId = 101, feed = newFeed) =>
  async () =>
    Response.json({
      results: [{ kind: 'podcast', collectionId: itunesId, feedUrl: feed }],
    });

async function apply(sql: postgres.Sql, plan: AppleIdentityPlan) {
  return sql.begin(async (tx) => {
    await lockPodcastIdentities(tx, plan.identities);
    const target = await findAppleSource(tx, plan.listing);
    if (!target) throw new Error('Missing fixture');
    return claimAppleIdentity(tx, target, plan);
  });
}

describe.skipIf(!process.env.PG_BIN)('Apple-authoritative associations', () => {
  let cluster: ReturnType<typeof startPostgres>;
  let sql: postgres.Sql;
  beforeAll(async () => {
    cluster = startPostgres();
    sql = cluster.sql;
    await createSchemaFixture(sql);
  });
  afterAll(async () => {
    await cluster?.stop();
  });
  beforeEach(async () => {
    await sql`TRUNCATE podcasts,authors,users,countries,genres RESTART IDENTITY CASCADE`;
    await sql`INSERT INTO authors(id,name) VALUES (1,'Publisher')`;
    await sql`INSERT INTO users(id,email) VALUES ('owner','owner@example.invalid')`;
    await sql`INSERT INTO podcasts(id,itunes_id,podcast_index_id,feed_url,title,author_id,cover) VALUES
      (1,101,501,${oldFeed},'Historical',1,''),(2,NULL,502,${newFeed},'Current',1,''),
      (4,NULL,504,'https://example.invalid/third','Third',1,'')`;
    await sql`INSERT INTO podcasts(id,owner_user_id,feed_url,title,author_id,cover) VALUES (3,'owner','https://example.invalid/private','Private',1,'')`;
    await sql`INSERT INTO episodes(id,podcast_id,guid,published) VALUES (11,1,'old-guid',now()),(22,2,'different-guid',now())`;
    await sql`INSERT INTO episode_content(episode_id,title,file_url) VALUES (11,'Historical','https://example.invalid/old.mp3'),(22,'Current','https://example.invalid/new.mp3')`;
    await sql`INSERT INTO subscriptions(user_id,podcast_id) VALUES ('owner',1),('owner',2)`;
    await sql`INSERT INTO playback_progress(user_id,episode_id,position) VALUES ('owner',11,17),('owner',22,29)`;
    await sql`INSERT INTO transcripts(episode_id,content,source) VALUES (11,'Retained transcript','fixture')`;
    await sql`INSERT INTO feed_poll_state(podcast_id,failures) VALUES (1,3),(2,1)`;
  });

  const preserved = async () =>
    (
      await sql`SELECT jsonb_build_object(
    'sources',(SELECT jsonb_agg(to_jsonb(p)-'itunes_id'-'updated_at' ORDER BY id) FROM podcasts p),
    'episodes',(SELECT jsonb_agg(e ORDER BY id) FROM episodes e),
    'content',(SELECT jsonb_agg(c ORDER BY episode_id) FROM episode_content c),
    'subscriptions',(SELECT jsonb_agg(s ORDER BY podcast_id) FROM subscriptions s),
    'progress',(SELECT jsonb_agg(p ORDER BY episode_id) FROM playback_progress p),
    'transcripts',(SELECT jsonb_agg(t ORDER BY episode_id) FROM transcripts t),
    'polling',(SELECT jsonb_agg(f ORDER BY podcast_id) FROM feed_poll_state f)
  ) AS state`
    )[0].state;
  const claims = async () => [
    ...(await sql`SELECT id::int,itunes_id::int FROM podcasts ORDER BY id`),
  ];

  test('fresh lookup moves a known preferred ID and preserves both catalogues and user data', async () => {
    const before = await preserved();
    expect(await resolvePodcast(sql, 101, 'my', lookup())).toBe(2);
    expect(await claims()).toEqual([
      { id: 1, itunes_id: null },
      { id: 2, itunes_id: 101 },
      { id: 3, itunes_id: null },
      { id: 4, itunes_id: null },
    ]);
    expect(await preserved()).toEqual(before);
  });

  test('preserves all unrelated listings when moving a preferred ID to a source with its own listing', async () => {
    await sql`UPDATE podcasts SET itunes_id=202 WHERE id=2`;
    await sql`INSERT INTO podcast_apple_aliases(itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (303,1,'reviewed','fixture'),(304,1,'reviewed','fixture')`;
    expect(await resolvePodcast(sql, 101, 'my', lookup())).toBe(2);
    expect(await claims()).toEqual([
      { id: 1, itunes_id: 303 },
      { id: 2, itunes_id: 202 },
      { id: 3, itunes_id: null },
      { id: 4, itunes_id: null },
    ]);
    expect([
      ...(await sql`SELECT itunes_id::int,podcast_id::int FROM podcast_apple_aliases ORDER BY itunes_id`),
    ]).toEqual([
      { itunes_id: 101, podcast_id: 2 },
      { itunes_id: 304, podcast_id: 1 },
    ]);
  });

  test('moves a secondary ID without clearing the old preferred claim', async () => {
    await sql`INSERT INTO podcast_apple_aliases(itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (303,1,'reviewed','fixture')`;
    expect(await resolvePodcast(sql, 303, 'my', lookup(303))).toBe(2);
    expect((await claims()).slice(0, 2)).toEqual([
      { id: 1, itunes_id: 101 },
      { id: 2, itunes_id: 303 },
    ]);
    expect(await sql`SELECT * FROM podcast_apple_aliases`).toHaveLength(0);
  });

  test('resolves an accepted feed alias without rewriting either canonical feed', async () => {
    const alias = 'https://example.invalid/accepted';
    await sql`INSERT INTO podcast_feed_aliases(feed_url,podcast_id,evidence_type,evidence_reference) VALUES (${alias},2,'reviewed','fixture')`;
    const before = await preserved();
    expect(await resolvePodcast(sql, 101, 'my', lookup(101, alias))).toBe(2);
    expect(await preserved()).toEqual(before);
  });

  test('unverified provider hints cannot reassign an existing claim', async () => {
    await expect(indexPodcast(sql, newFeed, 101)).rejects.toThrow(
      'different podcasts',
    );
    expect((await claims())[0].itunes_id).toBe(101);
  });

  test('missing, malformed and ambiguous Apple responses never fall back to the old mapping', async () => {
    for (const results of [
      [],
      [{ kind: 'podcast', collectionId: 101 }],
      [{ kind: 'podcast', collectionId: 999, feedUrl: newFeed }],
    ])
      expect(
        await resolvePodcast(sql, 101, 'my', async () =>
          Response.json({ results }),
        ),
      ).toBeNull();
    for (const response of [
      new Response(null, { status: 503 }),
      Response.json({}),
      Response.json({
        results: [
          { kind: 'podcast', collectionId: 101, feedUrl: newFeed },
          { kind: 'podcast', collectionId: 101, feedUrl: oldFeed },
        ],
      }),
      Response.json({
        results: [
          {
            kind: 'podcast',
            collectionId: 101,
            feedUrl: 'https://user:secret@example.invalid/feed',
          },
        ],
      }),
      Response.json({
        results: [
          { kind: 'podcast', collectionId: 101, feedUrl: newFeed },
          { kind: 'podcast', collectionId: 101 },
        ],
      }),
    ])
      await expect(
        resolvePodcast(sql, 101, 'my', async () => response),
      ).rejects.toThrow();
    expect((await claims())[0].itunes_id).toBe(101);
    expect((await claims())[1].itunes_id).toBeNull();
  });

  test('expired, future and invalid verification leaves identities unchanged', async () => {
    for (const verifiedAt of [
      'invalid',
      '2000-01-01T00:00:00Z',
      new Date(Date.now() + 60000).toISOString(),
    ]) {
      const plan = await prepareAppleIdentity(sql, {
        ...evidence(),
        verifiedAt,
      });
      await expect(apply(sql, plan)).rejects.toThrow('verification required');
    }
    expect((await claims())[0].itunes_id).toBe(101);
  });

  test('does not promote a private source while transferring another public claim', async () => {
    const before = await preserved();
    await expect(
      resolvePodcast(
        sql,
        101,
        'my',
        lookup(101, 'https://example.invalid/private'),
      ),
    ).rejects.toThrow('public sources');
    expect(await preserved()).toEqual(before);
    expect((await claims())[0].itunes_id).toBe(101);
  });

  test('changed claim ownership after preparation fails instead of overwriting a newer decision', async () => {
    const plan = await prepareAppleIdentity(sql, evidence());
    await resolvePodcast(
      sql,
      101,
      'my',
      lookup(101, 'https://example.invalid/third'),
    );
    await expect(apply(sql, plan)).rejects.toThrow(
      'changed during verification',
    );
    expect((await claims())[3]).toEqual({ id: 4, itunes_id: 101 });
  });

  test('new dependent aliases outside the lock plan require a retry', async () => {
    const plan = await prepareAppleIdentity(sql, evidence());
    await sql`INSERT INTO podcast_apple_aliases(itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (303,1,'reviewed','fixture')`;
    await expect(apply(sql, plan)).rejects.toThrow('lock set changed');
    expect((await claims())[0].itunes_id).toBe(101);
    expect(
      await sql`SELECT * FROM podcast_apple_aliases WHERE itunes_id=303`,
    ).toHaveLength(1);
  });

  test('destination failures roll back removal of the old preferred claim', async () => {
    await sql`ALTER TABLE podcasts ADD CONSTRAINT reject_apple_claim CHECK (id<>2 OR itunes_id IS NULL)`;
    try {
      await expect(resolvePodcast(sql, 101, 'my', lookup())).rejects.toThrow(
        'reject_apple_claim',
      );
      expect((await claims())[0].itunes_id).toBe(101);
    } finally {
      await sql`ALTER TABLE podcasts DROP CONSTRAINT reject_apple_claim`;
    }
  });

  test('concurrent matching evidence converges but competing plans cannot both reassign', async () => {
    const other = postgres(cluster.options);
    try {
      const plans = await Promise.all([
        prepareAppleIdentity(sql, evidence()),
        prepareAppleIdentity(other, evidence()),
      ]);
      expect(
        await Promise.all([apply(sql, plans[0]), apply(other, plans[1])]),
      ).toEqual([2, 2]);
      const competing = await Promise.all([
        prepareAppleIdentity(sql, evidence(101, oldFeed)),
        prepareAppleIdentity(
          other,
          evidence(101, 'https://example.invalid/third'),
        ),
      ]);
      const results = await Promise.allSettled([
        apply(sql, competing[0]),
        apply(other, competing[1]),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    } finally {
      await other.end();
    }
  });
});
