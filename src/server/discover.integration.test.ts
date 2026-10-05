import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createSchemaFixture } from '../../scripts/lib/schema-fixture';
import type { ChartPodcast } from './ingest/charts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `discover_test_${randomUUID().replaceAll('-', '')}`;
const DAY = 86_400_000;

const chartPodcast = (
  itunesId: number,
  rank: number,
  genres: number[],
): ChartPodcast => ({
  itunesId,
  rank,
  genres,
  verifiedAt: new Date().toISOString(),
  title: `Podcast ${itunesId}`,
  author: `Author ${itunesId}`,
  feed: `https://example.com/${itunesId}/feed`,
  cover: 'https://example.com/cover.jpg',
  thumbnail: null,
  explicit: false,
  count: 10,
});

describe.skipIf(!databaseUrl)('discovery with PostgreSQL', () => {
  let sql: postgres.Sql;
  let admin: postgres.Sql;
  let server: typeof import('./discover') &
    typeof import('./ingest/top') &
    typeof import('./ingest/charts') &
    typeof import('./ingest/podcast') &
    typeof import('./progress');
  const ids = new Map<number, number>();

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL required');
    admin = postgres(databaseUrl, { onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = postgres(databaseUrl, {
      connection: { search_path: schema },
      onnotice: () => {},
      types: {
        bigint: {
          to: 20,
          from: [20],
          serialize: (value: number) => String(value),
          parse: Number,
        },
      },
    });
    await createSchemaFixture(sql);
    mock.module('./db', () => ({ sql }));
    server = {
      ...(await import('./discover')),
      ...(await import('./ingest/top')),
      ...(await import('./ingest/charts')),
      ...(await import('./ingest/podcast')),
      ...(await import('./progress')),
    };
    await server.storeTopPodcasts(
      sql,
      [
        chartPodcast(101, 1, [1526, 26, 1489]),
        chartPodcast(102, 2, [1487, 26]),
        chartPodcast(103, 3, [1527, 26, 1489]),
        chartPodcast(104, 31, [1303, 26]),
        chartPodcast(105, 32, [9999, 26]),
      ],
      'us',
    );
    for (const row of await sql`SELECT id, itunes_id FROM podcasts`)
      ids.set(Number(row.itunes_id), Number(row.id));
    const day = (offset: number) =>
      new Date(Date.now() - offset * DAY).toISOString().slice(0, 10);
    await sql`
      INSERT INTO chart_history (country_id, day, podcast_id, rank) VALUES
        ('us', ${day(9)}::date, ${ids.get(101)!}, 9),
        ('us', ${day(3)}::date, ${ids.get(101)!}, 4),
        ('us', ${day(3)}::date, ${ids.get(102)!}, 1)
    `;
    const published = (podcast: number, offsets: number[]) =>
      Promise.all(
        offsets.map(
          (offset, index) => sql`
            INSERT INTO episodes (podcast_id, guid, published)
            VALUES (${ids.get(podcast)!}, ${`${podcast}-${index}`}, ${new Date(Date.now() - offset * DAY)})
          `,
        ),
      );
    await published(101, [1, 400]);
    await published(102, [2, 30]);
    await published(103, [5, 90]);
    await published(104, [20, 2000]);
    await sql`INSERT INTO users (id, email) VALUES ('a', 'a@example.com'), ('b', 'b@example.com'), ('c', 'c@example.com'), ('d', 'd@example.com')`;
    await sql`
      INSERT INTO subscriptions (user_id, podcast_id)
      SELECT u, p FROM unnest(ARRAY['a','b','c']) u, unnest(${[ids.get(104)!, ids.get(105)!]}::bigint[]) p
    `;
    await sql`INSERT INTO subscriptions (user_id, podcast_id) VALUES ('d', ${ids.get(104)!}), ('d', ${ids.get(102)!})`;
  });

  afterAll(async () => {
    await sql?.end();
    if (admin) {
      await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
      await admin.end();
    }
  });

  test('chart ingest keeps known Apple genres with the primary genre first', async () => {
    const rows = await sql`
      SELECT p.itunes_id::int, p.primary_genre_id, array_agg(pg.genre_id ORDER BY pg.genre_id) AS genres
      FROM podcasts p LEFT JOIN podcasts_genres pg ON pg.podcast_id = p.id
      GROUP BY p.id ORDER BY p.itunes_id
    `;
    expect(rows.map((row) => [row.itunes_id, row.primary_genre_id])).toEqual([
      [101, 1526],
      [102, 1487],
      [103, 1527],
      [104, 1303],
      [105, null],
    ]);
    expect(rows[0].genres).toEqual([1489, 1526]);
    expect(
      Number(
        (
          await sql`SELECT count(*) FROM chart_history WHERE day = (now() AT TIME ZONE 'UTC')::date`
        )[0].count,
      ),
    ).toBe(5);
  });

  test('the chart reports genre, category and rank a week earlier', async () => {
    const chart = await server.getTopPodcasts(30, 'us');
    expect(
      chart.map(({ title, previousRank, genre, category }) => [
        title,
        previousRank,
        genre?.name,
        category?.name,
      ]),
    ).toEqual([
      ['Podcast 101', 4, 'Daily News', 'News'],
      ['Podcast 102', 1, 'History', 'History'],
      ['Podcast 103', null, 'Politics', 'News'],
      ['Podcast 104', null, 'Comedy', 'Comedy'],
      ['Podcast 105', null, undefined, undefined],
    ]);
    expect(await server.getTopPodcasts(30, 'nl')).toEqual([]);
  });

  test('noteworthy puts recent debuts first, then the chart beyond the top 30', async () => {
    expect(
      (await server.noteworthy('us', 14, null)).map(({ title }) => title),
    ).toEqual(['Podcast 102', 'Podcast 103', 'Podcast 104', 'Podcast 105']);
    expect(
      (await server.noteworthy('us', 14, 1489)).map(({ title }) => title),
    ).toEqual(['Podcast 103']);
  });

  test('related podcasts need shared listeners, then share the category', async () => {
    expect(
      (await server.related(ids.get(104)!, 'us', 4)).map(({ title }) => title),
    ).toEqual(['Podcast 105']);
    expect(
      (await server.related(ids.get(101)!, 'us', 4)).map(({ title }) => title),
    ).toEqual(['Podcast 103']);
  });

  test('podcast info carries its genres and first episode', async () => {
    const info = await server.getPodcastInfoById(ids.get(102)!);
    expect(info?.genre).toEqual({ id: 1487, name: 'History' });
    expect(info?.category).toEqual({ id: 1487, name: 'History' });
    expect(Math.round((Date.now() - (info?.firstPublished ?? 0)) / DAY)).toBe(
      30,
    );
  });

  test('podcast progress and the unplayed filter are per account', async () => {
    const episodes = await sql`
      SELECT id FROM episodes WHERE podcast_id = ${ids.get(102)!} ORDER BY published DESC
    `;
    await server.saveProgress('a', Number(episodes[0].id), 120, false);
    await server.saveProgress('a', Number(episodes[1].id), 0, true);
    expect(await server.getPodcastProgress('a', ids.get(102)!)).toEqual(
      [
        { episodeId: Number(episodes[0].id), position: 120, completed: false },
        { episodeId: Number(episodes[1].id), position: 0, completed: true },
      ].sort((a, b) => a.episodeId - b.episodeId),
    );
    expect(await server.getPodcastProgress('b', ids.get(102)!)).toEqual([]);
    await sql`
      INSERT INTO episode_content (episode_id, title, file_url)
      SELECT id, guid, 'https://example.com/' || guid || '.mp3' FROM episodes WHERE podcast_id = ${ids.get(102)!}
    `;
    const { readEpisodePage } = await import('./ingest/episode-read');
    const titles = async (unplayedBy?: string) =>
      (
        await readEpisodePage(sql, { podcastId: ids.get(102)!, unplayedBy })
      ).episodes.map(({ id }) => Number(id));
    expect(await titles()).toEqual(episodes.map(({ id }) => Number(id)));
    expect(await titles('a')).toEqual([Number(episodes[0].id)]);
    expect(await titles('b')).toEqual(episodes.map(({ id }) => Number(id)));
    expect(
      (
        await server.getEpisodeProgress(
          'a',
          episodes.map(({ id }) => Number(id)),
        )
      ).map(({ completed }) => completed),
    ).toHaveLength(2);
    expect(
      await server.getEpisodeProgress('b', [Number(episodes[0].id)]),
    ).toEqual([]);
    const recent = await server.getRecentProgress('a', 3);
    expect(
      recent.map(({ episode, position }) => [episode.id, position]),
    ).toEqual([[Number(episodes[0].id), 120]]);
  });
});
