import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { startPostgres } from './lib/postgres-sandbox';
import { createSchemaFixture } from './lib/schema-fixture';
import {
  MergeError,
  mergePair,
  parseMergeArgs,
  parseMergePlan,
} from './merge-duplicate-podcasts';

describe('merge arguments and plans', () => {
  test('dry run is the default and apply is explicit', () => {
    expect(parseMergeArgs(['--plan', 'plan.json'])).toEqual({
      plan: 'plan.json',
      apply: false,
    });
    expect(parseMergeArgs(['--plan', 'plan.json', '--apply'])).toEqual({
      plan: 'plan.json',
      apply: true,
    });
    for (const args of [[], ['--plan'], ['plan.json', '--apply'], ['--apply']])
      expect(() => parseMergeArgs(args)).toThrow(MergeError);
  });

  test('plans merge each duplicate once into a survivor', () => {
    const pairs = [
      { survivor: '3', duplicate: '1' },
      { survivor: '3', duplicate: '2' },
    ];
    expect(parseMergePlan({ reference: 'review-1', pairs })).toEqual({
      reference: 'review-1',
      pairs,
    });
    for (const plan of [
      {},
      { reference: 'review-1', pairs: [] },
      { reference: 'has spaces', pairs },
      { reference: 'review-1', pairs: [{ survivor: '1', duplicate: '1' }] },
      { reference: 'review-1', pairs: [{ survivor: 'x', duplicate: '1' }] },
      {
        reference: 'review-1',
        pairs: [...pairs, { survivor: '4', duplicate: '1' }],
      },
      {
        reference: 'review-1',
        pairs: [...pairs, { survivor: '4', duplicate: '3' }],
      },
    ])
      expect(() => parseMergePlan(plan)).toThrow(MergeError);
  });
});

describe.skipIf(!process.env.PG_BIN)(
  'duplicate podcast merges on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;

    const snapshot = async () => {
      const { sql } = cluster;
      return {
        podcasts: Array.from(
          await sql`SELECT id::text, itunes_id::text, episode_count FROM podcasts ORDER BY id`,
        ),
        episodes: Array.from(
          await sql`SELECT id::text, podcast_id::text, guid FROM episodes ORDER BY id`,
        ),
        ranks: Array.from(
          await sql`SELECT country_id, rank, podcast_id::text FROM top_podcasts ORDER BY country_id`,
        ),
        history: Array.from(
          await sql`SELECT country_id, podcast_id::text FROM chart_history ORDER BY country_id, podcast_id`,
        ),
        feedAliases: Array.from(
          await sql`SELECT feed_url, podcast_id::text, evidence_type FROM podcast_feed_aliases ORDER BY feed_url COLLATE "C"`,
        ),
        appleAliases: Array.from(
          await sql`SELECT itunes_id::text, podcast_id::text FROM podcast_apple_aliases ORDER BY itunes_id`,
        ),
      };
    };

    beforeAll(() => {
      cluster = startPostgres();
    }, 30_000);

    afterAll(async () => {
      await cluster?.stop();
    });

    beforeEach(async () => {
      const { sql } = cluster;
      await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
      await createSchemaFixture(sql);
      await sql.unsafe(`
        INSERT INTO countries(id,name) VALUES ('us','US'),('jp','JP') ON CONFLICT DO NOTHING;
        INSERT INTO genres(id,name) VALUES (0,'All') ON CONFLICT DO NOTHING;
        INSERT INTO authors(id,name) VALUES (1,'Synthetic publisher');
        INSERT INTO users(id,email) VALUES ('listener','listener@example.invalid');
        INSERT INTO podcasts(id,feed_url,title,author_id,cover,itunes_id,episode_count,last_published) VALUES
          (10,'https://old.example.invalid/feed','Show',1,'cover',111,3,'2025-01-03Z'),
          (20,'https://new.example.invalid/feed','Show',1,'cover',NULL,2,'2026-10-01Z'),
          (30,'https://other.example.invalid/feed','Other',1,'cover',NULL,1,NULL),
          (40,'https://kept.example.invalid/feed','Kept',1,'cover',444,1,NULL);
        INSERT INTO podcast_feed_aliases(feed_url,podcast_id,evidence_type,evidence_reference)
          VALUES ('https://older.example.invalid/feed',10,'reviewed','fixture');
        INSERT INTO podcast_apple_aliases(itunes_id,podcast_id,evidence_type,evidence_reference)
          VALUES (112,10,'reviewed','fixture');
        INSERT INTO episodes(id,podcast_id,guid,published) VALUES
          (1,10,'shared','2025-01-01Z'),(2,10,'old-only','2025-01-02Z'),(3,10,'also-shared','2025-01-03Z'),
          (4,20,'shared','2025-01-01Z'),(5,20,'also-shared','2026-10-01Z'),
          (6,30,'unrelated','2025-01-01Z'),(7,40,'shared','2025-01-01Z');
        INSERT INTO top_podcasts(country_id,genre_id,rank,podcast_id) VALUES ('us',0,1,10),('jp',0,4,10),('jp',0,2,20);
        INSERT INTO chart_history(country_id,day,podcast_id,rank) VALUES ('us','2026-10-01',10,1),('jp','2026-10-01',10,4),('jp','2026-10-01',20,2);
      `);
    });

    test('dry run reports the merge and leaves the database unchanged', async () => {
      const before = await snapshot();
      const result = await mergePair(cluster.sql, 'review-1', {
        survivor: '20',
        duplicate: '10',
      });
      expect(result).toMatchObject({
        status: 'rolled_back',
        sharedEpisodesRemoved: 2,
        episodesMoved: 1,
      });
      expect(await snapshot()).toEqual(before);
    });

    test('the survivor takes over the duplicate identity and unique episodes', async () => {
      const result = await mergePair(
        cluster.sql,
        'review-1',
        { survivor: '20', duplicate: '10' },
        true,
      );
      expect(result).toMatchObject({
        status: 'committed',
        survivor: { id: '20', title: 'Show' },
        duplicate: { id: '10', itunesId: '111' },
        sharedEpisodesRemoved: 2,
        episodesMoved: 1,
        chartRanksMoved: 1,
        chartHistoryMoved: 1,
        feedAliasesAdded: 2,
        appleAliasesAdded: 1,
        survivorAfter: { episode_count: 3, itunes_id: '111' },
      });
      const after = await snapshot();
      expect(after.podcasts).toEqual([
        { id: '20', itunes_id: '111', episode_count: 3 },
        { id: '30', itunes_id: null, episode_count: 1 },
        { id: '40', itunes_id: '444', episode_count: 1 },
      ]);
      expect(after.episodes).toEqual([
        { id: '2', podcast_id: '20', guid: 'old-only' },
        { id: '4', podcast_id: '20', guid: 'shared' },
        { id: '5', podcast_id: '20', guid: 'also-shared' },
        { id: '6', podcast_id: '30', guid: 'unrelated' },
        { id: '7', podcast_id: '40', guid: 'shared' },
      ]);
      expect(after.ranks).toEqual([
        { country_id: 'jp', rank: 2, podcast_id: '20' },
        { country_id: 'us', rank: 1, podcast_id: '20' },
      ]);
      expect(after.history).toEqual([
        { country_id: 'jp', podcast_id: '20' },
        { country_id: 'us', podcast_id: '20' },
      ]);
      expect(after.feedAliases).toEqual([
        {
          feed_url: 'https://old.example.invalid/feed',
          podcast_id: '20',
          evidence_type: 'reviewed',
        },
        {
          feed_url: 'https://older.example.invalid/feed',
          podcast_id: '20',
          evidence_type: 'reviewed',
        },
      ]);
      expect(after.appleAliases).toEqual([
        { itunes_id: '112', podcast_id: '20' },
      ]);
      const [podcast] = await cluster.sql`
        SELECT last_published FROM podcasts WHERE id = 20
      `;
      expect(podcast.last_published.toISOString()).toBe(
        '2026-10-01T00:00:00.000Z',
      );
    });

    test('a survivor with its own Apple ID keeps it and aliases the other', async () => {
      await mergePair(
        cluster.sql,
        'review-1',
        { survivor: '40', duplicate: '20' },
        true,
      );
      await cluster.sql`DELETE FROM podcasts WHERE id = 30`;
      await cluster.sql`UPDATE podcasts SET itunes_id = 333 WHERE id = 40`;
      const result = await mergePair(
        cluster.sql,
        'review-2',
        { survivor: '40', duplicate: '10' },
        true,
      );
      expect(result).toMatchObject({
        appleAliasesAdded: 2,
        survivorAfter: { itunes_id: '333' },
      });
      expect((await snapshot()).appleAliases).toEqual([
        { itunes_id: '111', podcast_id: '40' },
        { itunes_id: '112', podcast_id: '40' },
      ]);
    });

    test('refuses merges without shared episodes, with account references or private sources', async () => {
      const before = await snapshot();
      await expect(
        mergePair(
          cluster.sql,
          'review-1',
          { survivor: '20', duplicate: '30' },
          true,
        ),
      ).rejects.toThrow('share no episode GUIDs');
      await expect(
        mergePair(
          cluster.sql,
          'review-1',
          { survivor: '20', duplicate: '99' },
          true,
        ),
      ).rejects.toThrow('Both podcasts must exist');
      await cluster.sql`
        INSERT INTO subscriptions(user_id,podcast_id,subscribed_at,revision) VALUES ('listener',10,now(),1)
      `;
      await expect(
        mergePair(
          cluster.sql,
          'review-1',
          { survivor: '20', duplicate: '10' },
          true,
        ),
      ).rejects.toThrow('account references');
      await cluster.sql`DELETE FROM subscriptions`;
      await cluster.sql`
        INSERT INTO playback_progress(user_id,episode_id,position,completed,updated_at,revision)
        VALUES ('listener',2,10,false,now(),1)
      `;
      await expect(
        mergePair(
          cluster.sql,
          'review-1',
          { survivor: '20', duplicate: '10' },
          true,
        ),
      ).rejects.toThrow('account references');
      await cluster.sql`DELETE FROM playback_progress`;
      await cluster.sql`UPDATE podcasts SET owner_user_id = 'listener' WHERE id = 20`;
      await expect(
        mergePair(
          cluster.sql,
          'review-1',
          { survivor: '20', duplicate: '10' },
          true,
        ),
      ).rejects.toThrow('Private podcasts');
      await cluster.sql`UPDATE podcasts SET owner_user_id = NULL WHERE id = 20`;
      expect(await snapshot()).toEqual(before);
    });
  },
);
