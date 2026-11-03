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
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { prepareEpisodeRead } from './episode-read';
import { FeedAdmissionError } from './feed-demand';
import { resolveShortUrl } from './short-url';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `short_url_test_${randomUUID().replaceAll('-', '')}`;
const podcastId = '9007199254740993';
const episodeId = '9007199254740995';

describe.skipIf(!databaseUrl)('short URL resolution with PostgreSQL', () => {
  let sql: postgres.Sql;
  let admin: postgres.Sql;
  let server: ReturnType<typeof Bun.serve>;
  let requests: number;
  let admissions: number;
  let statements: {
    query: string;
    parameters: postgres.ParameterOrJSON<never>[];
  }[] = [];
  const prepare: typeof prepareEpisodeRead = (client, id, userId, episode) =>
    prepareEpisodeRead(client, id, userId, episode, async () => {
      admissions++;
    });
  const resolve = (guid = 'shared', feed = server.url.href) =>
    resolveShortUrl(sql, { feed, guid }, prepare);

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL required');
    admin = postgres(databaseUrl, { onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = postgres(databaseUrl, {
      connection: { search_path: schema },
      onnotice: () => {},
      debug: (_connection, query, parameters) =>
        statements.push({ query, parameters }),
    });
    await createSchemaFixture(sql);
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        requests++;
        return new Response(null, { status: 503 });
      },
    });
  });

  afterAll(async () => {
    server?.stop(true);
    await sql?.end();
    if (admin) {
      await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
      await admin.end();
    }
  });

  beforeEach(async () => {
    requests = 0;
    admissions = 0;
    await sql`TRUNCATE authors, users RESTART IDENTITY CASCADE`;
    await sql`INSERT INTO users (id, email) VALUES ('owner', 'owner@example.invalid')`;
    await sql`INSERT INTO authors (id, name) VALUES (1, 'Author')`;
    await sql`
      INSERT INTO podcasts (id, feed_url, title, author_id, cover, owner_user_id)
      VALUES (${podcastId}, ${server.url.href}, 'Public', 1, '', NULL),
             (2, 'https://example.invalid/other', 'Other', 1, '', NULL),
             (3, 'https://example.invalid/private', 'Private', 1, '', 'owner')
    `;
    await sql`
      INSERT INTO episodes (id, podcast_id, guid, published)
      VALUES (${episodeId}, ${podcastId}, 'shared', '2026-01-01'),
             (102, ${podcastId}, 'second', '2026-01-02'),
             (201, 2, 'shared', '2026-01-01'),
             (301, 3, 'shared', '2026-01-01')
    `;
    await sql`
      INSERT INTO episode_content (episode_id, title, summary, file_url)
      SELECT id, guid, 'Episode description', 'https://example.invalid/audio.mp3'
      FROM episodes
    `;
    statements = [];
  });

  test('finds an episode within its podcast and records access without fetching', async () => {
    expect(
      await resolveShortUrl(sql, { feed: server.url.href, guid: 'shared' }),
    ).toEqual({ podcastId, episodeId });
    expect(await resolve('shared', 'https://example.invalid/other')).toEqual({
      podcastId: '2',
      episodeId: '201',
    });
    const [podcast] =
      await sql`SELECT last_accessed_at FROM podcasts WHERE id = ${podcastId}`;
    expect(podcast.last_accessed_at).toBeInstanceOf(Date);
    expect(admissions).toBe(0);
    expect(requests).toBe(0);
  });

  test('falls back for an absent GUID, including one belonging to another podcast', async () => {
    await sql`UPDATE episodes SET guid = 'other-only' WHERE id = 201`;
    for (const guid of ['missing', 'other-only', 'SHARED']) {
      expect(await resolve(guid)).toEqual({ podcastId, episodeId: null });
    }
    expect(admissions).toBe(0);
  });

  test('matches empty GUIDs exactly', async () => {
    expect(await resolve('')).toEqual({ podcastId, episodeId: null });
    await sql`UPDATE episodes SET guid = '' WHERE id = ${episodeId}`;
    expect(await resolve('')).toEqual({ podcastId, episodeId });
  });

  test('returns no target for an unknown feed', async () => {
    expect(
      await resolve('shared', 'https://example.invalid/unknown'),
    ).toBeNull();
    expect(admissions).toBe(0);
    expect(requests).toBe(0);
    expect(statements.some(({ query }) => /UPDATE podcasts/.test(query))).toBe(
      false,
    );
  });

  test('private podcasts are inaccessible without access tracking or repair', async () => {
    await sql`DELETE FROM episode_content WHERE episode_id = 301`;
    expect(
      await resolve('shared', 'https://example.invalid/private'),
    ).toBeNull();
    const [podcast] =
      await sql`SELECT last_accessed_at FROM podcasts WHERE id = 3`;
    expect(podcast.last_accessed_at).toBeNull();
    expect(
      await sql`SELECT * FROM feed_poll_state WHERE podcast_id = 3`,
    ).toHaveLength(0);
    expect(admissions).toBe(0);
    expect(requests).toBe(0);
  });

  test('resolves accepted public feed aliases', async () => {
    const alias = 'https://example.invalid/old-feed';
    await sql`
      INSERT INTO podcast_feed_aliases (feed_url, podcast_id, evidence_type, evidence_reference)
      VALUES (${alias}, ${podcastId}, 'reviewed', 'short-url-fixture')
    `;
    expect(await resolve('shared', alias)).toEqual({ podcastId, episodeId });
  });

  test('an evicted episode falls back without repairing a partly cached podcast', async () => {
    await sql`DELETE FROM episode_content WHERE episode_id = ${episodeId}`;
    expect(await resolve()).toEqual({ podcastId, episodeId: null });
    expect(admissions).toBe(0);
    expect(requests).toBe(0);
  });

  test('a cold podcast retains coalesced background repair and the podcast fallback', async () => {
    await sql`
      DELETE FROM episode_content
      WHERE episode_id IN (SELECT id FROM episodes WHERE podcast_id = ${podcastId})
    `;
    expect(await resolve()).toEqual({ podcastId, episodeId: null });
    const [demand] = await sql`
      SELECT demand_token, demand_rebuild, demand_expires_at > now() AS active
      FROM feed_poll_state WHERE podcast_id = ${podcastId}
    `;
    expect(demand).toMatchObject({ demand_rebuild: true, active: true });
    expect(demand.demand_token).toBeString();
    expect(await resolve()).toEqual({ podcastId, episodeId: null });
    expect(admissions).toBe(1);
    expect(requests).toBe(0);
  });

  test('failed repair admission still permits the podcast fallback', async () => {
    await sql`DELETE FROM episode_content`;
    const unavailable: typeof prepareEpisodeRead = (client, id) =>
      prepareEpisodeRead(client, id, null, undefined, async () => {
        throw new FeedAdmissionError('rate_limited');
      });
    expect(
      await resolveShortUrl(
        sql,
        { feed: server.url.href, guid: 'shared' },
        unavailable,
      ),
    ).toEqual({ podcastId, episodeId: null });
    expect(await sql`SELECT * FROM feed_poll_state`).toHaveLength(0);
    expect(requests).toBe(0);
  });

  test('stale cached content does not request a refresh during the redirect', async () => {
    await sql`
      INSERT INTO feed_poll_state (podcast_id, last_success_at)
      VALUES (${podcastId}, now() - interval '1 day')
    `;
    expect(await resolve()).toEqual({ podcastId, episodeId });
    expect(admissions).toBe(0);
    expect(requests).toBe(0);
  });

  test('rechecks access after preparation', async () => {
    const revoke: typeof prepareEpisodeRead = async (client, id) => {
      const freshness = await prepare(client, id);
      await client`UPDATE podcasts SET owner_user_id = 'owner' WHERE id = ${id}`;
      return freshness;
    };
    expect(
      await resolveShortUrl(
        sql,
        { feed: server.url.href, guid: 'shared' },
        revoke,
      ),
    ).toBeNull();
  });

  test('large catalogues use the GUID index and return only redirect IDs', async () => {
    await sql`
      INSERT INTO episodes (id, podcast_id, guid, published)
      SELECT id, ${podcastId}, 'archive-' || id, '2025-01-01'::timestamptz
      FROM generate_series(100000, 119999) id
    `;
    await sql`
      INSERT INTO episode_content (episode_id, title, summary, file_url)
      SELECT id, guid, repeat('Archive description ', 100), 'https://example.invalid/audio.mp3'
      FROM episodes WHERE id BETWEEN 100000 AND 119999
    `;
    await sql`ANALYZE episodes`;
    await sql`ANALYZE episode_content`;
    statements = [];
    expect(await resolve('archive-119999')).toEqual({
      podcastId,
      episodeId: '119999',
    });
    expect(
      statements.some(({ query }) => /c\.(title|summary|file_url)/.test(query)),
    ).toBe(false);
    const lookup = statements.find(({ query }) =>
      query.includes('AS "episodeId"'),
    );
    if (!lookup) throw new Error('Missing targeted episode lookup');
    const [explain] = await sql.unsafe(
      `EXPLAIN (ANALYZE, FORMAT JSON) ${lookup.query}`,
      lookup.parameters,
    );
    const plan = explain['QUERY PLAN'][0].Plan;
    expect(plan['Actual Rows']).toBe(1);
    expect(JSON.stringify(plan)).toContain('episodes_podcast_id_guid_key');
    expect(await resolve('archive-missing')).toEqual({
      podcastId,
      episodeId: null,
    });
    expect(admissions).toBe(0);
    expect(requests).toBe(0);
  });
});
