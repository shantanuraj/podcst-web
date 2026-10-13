import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { storeCatalogPodcast } from '../src/server/ingest/catalog';
import {
  clearUnlisted,
  findUnlisted,
  parseUnlistedArgs,
  servedAppleClaims,
  UnlistedAppleIdError,
} from './clear-unlisted-apple-ids';
import { startPostgres } from './lib/postgres-sandbox';
import { createSchemaFixture } from './lib/schema-fixture';

const storefront =
  (listed: Record<string, number[]>, requests: string[] = []) =>
  async (url: string) => {
    const { searchParams } = new URL(url);
    const country = searchParams.get('country') ?? '';
    requests.push(`${country}:${searchParams.get('id')}`);
    return Response.json({
      results: (listed[country] ?? [])
        .filter((id) => searchParams.get('id')?.split(',').includes(String(id)))
        .map((collectionId) => ({ kind: 'podcast', collectionId })),
    });
  };

describe('unlisted Apple ID lookups', () => {
  test('dry run is the default and apply is explicit', () => {
    expect(parseUnlistedArgs([])).toEqual({ ids: null, apply: false });
    expect(parseUnlistedArgs(['--ids', 'ids.json', '--apply'])).toEqual({
      ids: 'ids.json',
      apply: true,
    });
    for (const args of [['--ids'], ['ids.json'], ['--force']])
      expect(() => parseUnlistedArgs(args)).toThrow(UnlistedAppleIdError);
  });

  test('an ID is unlisted only when no storefront returns it', async () => {
    const requests: string[] = [];
    const { unlisted } = await findUnlisted(
      ['101', '202', '303', '101'],
      ['us', 'jp', 'gb'],
      storefront({ us: [101], jp: [202] }, requests),
      async () => {},
    );
    expect([...unlisted]).toEqual(['303']);
    expect(requests).toEqual(['us:101,202,303', 'jp:202,303', 'gb:303']);
  });

  test('stops asking once every ID is found', async () => {
    const requests: string[] = [];
    const { unlisted } = await findUnlisted(
      ['101'],
      ['us', 'jp'],
      storefront({ us: [101] }, requests),
      async () => {},
    );
    expect(unlisted.size).toBe(0);
    expect(requests).toEqual(['us:101']);
  });

  test('a failed lookup aborts rather than declaring IDs unlisted', async () => {
    await expect(
      findUnlisted(
        ['101'],
        ['us'],
        async () => new Response(null, { status: 503 }),
        async () => {},
      ),
    ).rejects.toThrow('HTTP 503');
  });
});

describe.skipIf(!process.env.PG_BIN)(
  'clearing unlisted Apple IDs on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;

    const identities = async () =>
      Array.from(
        await cluster.sql`
          SELECT p.id::text, p.itunes_id::text,
            coalesce((SELECT array_agg(a.itunes_id::text ORDER BY a.itunes_id)
              FROM podcast_apple_aliases a WHERE a.podcast_id = p.id), '{}') AS aliases
          FROM podcasts p ORDER BY p.id
        `,
      );
    const unlistedRows = async () =>
      (
        await cluster.sql`SELECT itunes_id::text FROM unlisted_apple_ids ORDER BY 1`
      ).map(({ itunes_id }) => itunes_id);

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
        INSERT INTO authors(id,name) VALUES (1,'Synthetic publisher');
        INSERT INTO users(id,email) VALUES ('listener','listener@example.invalid');
        INSERT INTO podcasts(id,feed_url,title,author_id,cover,itunes_id,is_essential) VALUES
          (1,'https://one.example.invalid/feed','Dead only',1,'',101,true),
          (2,'https://two.example.invalid/feed','Dead with live alias',1,'',201,false),
          (3,'https://three.example.invalid/feed','Dead alias',1,'',301,false),
          (4,'https://four.example.invalid/feed','Unserved',1,'',401,false);
        INSERT INTO podcast_apple_aliases(itunes_id,podcast_id,evidence_type,evidence_reference) VALUES
          (202,2,'reviewed','fixture'),(203,2,'reviewed','fixture'),(302,3,'reviewed','fixture');
        INSERT INTO subscriptions(user_id,podcast_id,subscribed_at,revision) VALUES ('listener',2,now(),1);
      `);
    });

    test('checks preferred IDs and aliases of essential, followed and named podcasts', async () => {
      expect(await servedAppleClaims(cluster.sql)).toEqual([
        { podcastId: '1', itunesId: '101', preferred: true },
        { podcastId: '2', itunesId: '201', preferred: true },
        { podcastId: '2', itunesId: '202', preferred: false },
        { podcastId: '2', itunesId: '203', preferred: false },
      ]);
      expect(
        (await servedAppleClaims(cluster.sql, ['3'])).map(
          ({ itunesId }) => itunesId,
        ),
      ).toEqual(['101', '201', '202', '203', '301', '302']);
    });

    test('dry run reports and rolls back', async () => {
      const before = await identities();
      expect(
        await clearUnlisted(cluster.sql, '1', new Set(['101'])),
      ).toMatchObject({
        status: 'rolled_back',
        removed: ['101'],
        preferred: { from: '101', to: null },
      });
      expect(await identities()).toEqual(before);
      expect(await unlistedRows()).toEqual([]);
    });

    test('unsets dead preferred IDs, promotes a live alias and drops dead aliases', async () => {
      const unlisted = new Set(['101', '201', '203', '302']);
      for (const id of ['1', '2', '3'])
        await clearUnlisted(cluster.sql, id, unlisted, true);
      expect(await identities()).toEqual([
        { id: '1', itunes_id: null, aliases: [] },
        { id: '2', itunes_id: '202', aliases: [] },
        { id: '3', itunes_id: '301', aliases: [] },
        { id: '4', itunes_id: '401', aliases: [] },
      ]);
      expect(await unlistedRows()).toEqual(['101', '201', '203', '302']);
      expect(
        await clearUnlisted(cluster.sql, '4', unlisted, true),
      ).toBeUndefined();
    });

    test('the catalogue sync does not restore an unlisted Apple ID', async () => {
      await clearUnlisted(cluster.sql, '1', new Set(['101']), true);
      expect(
        await storeCatalogPodcast(cluster.sql, {
          podcastIndexId: 501,
          itunesId: '101',
          feed: 'https://one.example.invalid/feed',
          authorId: 1,
          title: 'Dead only',
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
        }),
      ).toBe('updated');
      const [podcast] = await cluster.sql`
        SELECT itunes_id, podcast_index_id FROM podcasts WHERE id = 1
      `;
      expect(podcast).toEqual({ itunes_id: null, podcast_index_id: 501 });
    });
  },
);
