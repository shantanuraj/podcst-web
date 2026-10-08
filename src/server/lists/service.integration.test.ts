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
import type { ListBatch, ListChange } from '@/shared/lists';
import { fixtureId } from '../../../scripts/lib/identity-fixture';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { parseListCursor } from './input';
import { createEpisodeListService, type EpisodeListService } from './service';

let generation = '';
const scope = () => ({ protocol: 1 as const, accountId: 'owner', generation });
const batch = (
  changes: ListChange[],
  clientId: string = randomUUID(),
  sequence = '1',
): ListBatch => ({
  ...scope(),
  clientId,
  sequence,
  changes,
});
const add = (episodeId: number | string): ListChange => ({
  op: 'add',
  episodeId: fixtureId(episodeId),
});
const remove = (episodeId: number | string): ListChange => ({
  op: 'remove',
  episodeId: fixtureId(episodeId),
});

describe.skipIf(!process.env.PG_BIN)(
  'episode lists on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let service: EpisodeListService;
    let listId: string;

    beforeAll(async () => {
      cluster = startPostgres();
      sql = postgres({
        ...cluster.options,
        max: 8,
        connection: { timezone: 'UTC' },
      });
      await createSchemaFixture(sql);
      service = createEpisodeListService(sql);
    }, 30_000);

    afterAll(async () => {
      await sql?.end();
      await cluster?.stop();
    });

    beforeEach(async () => {
      await sql`TRUNCATE users, authors RESTART IDENTITY CASCADE`;
      await sql`
      INSERT INTO users (id, email) VALUES
        ('owner', 'owner@example.invalid'), ('other', 'other@example.invalid')
    `;
      await sql`INSERT INTO authors (id, name) VALUES (1, 'Author')`;
      await sql`
      INSERT INTO podcasts (id, author_id, feed_url, title, cover, owner_user_id) VALUES
        (1, 1, 'https://public.example.invalid/rss', 'Public', 'cover', NULL),
        (2, 1, 'https://owner.example.invalid/secret', 'Private', 'cover', 'owner'),
        (3, 1, 'https://other.example.invalid/secret', 'Hidden', 'cover', 'other')
    `;
      await sql`
      INSERT INTO episodes (id, podcast_id, guid, published) VALUES
        (101, 1, 'shared', '2026-01-01'), (102, 1, 'missing', '2026-01-02'),
        (103, 1, 'newer', '2026-01-03'), (201, 2, 'shared', '2026-01-01'),
        (301, 3, 'shared', '2026-01-01')
    `;
      await sql`
      INSERT INTO episode_content (episode_id, title, file_url) VALUES
        (101, 'Public episode', 'https://public.example.invalid/audio.mp3'),
        (103, 'Newer episode', 'https://public.example.invalid/newer.mp3'),
        (201, 'Private episode', 'https://owner.example.invalid/secret.mp3'),
        (301, 'Hidden episode', 'https://other.example.invalid/secret.mp3')
    `;
      const collection = await service.lists('owner');
      listId = collection.lists[0].id;
      generation = collection.generation;
    });

    test('bootstraps one built-in list concurrently and isolates accounts', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => service.lists('owner')),
      );
      expect(
        new Set(results.flatMap(({ lists }) => lists.map(({ id }) => id))),
      ).toEqual(new Set([listId]));
      expect(results[0].lists[0]).toEqual({
        id: listId,
        kind: 'starred',
        name: null,
        revision: '0',
        itemCount: 0,
      });
      const other = (await service.lists('other')).lists[0];
      expect(other.id).not.toBe(listId);
      await expect(service.membership('other', listId)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        service.episodes('other', listId, { limit: 10 }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.change('other', listId, {
          ...batch([add(101)]),
          accountId: 'other',
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await sql`SELECT * FROM episode_list_clients`).toHaveLength(0);
    });

    test('enforces built-in and playlist name constraints', async () => {
      for (const [kind, name] of [
        ['starred', 'Stars'],
        ['playlist', null],
        ['playlist', ' '],
        ['playlist', ' name'],
        ['playlist', 'x'.repeat(101)],
      ]) {
        await expect(
          Promise.resolve(sql`
          INSERT INTO episode_lists (id, user_id, kind, name)
          VALUES (${randomUUID()}, 'owner', ${kind}, ${name})
        `),
        ).rejects.toMatchObject({ code: '23514' });
      }
      await sql`
      INSERT INTO episode_lists (id, user_id, kind, name) VALUES
        (${randomUUID()}, 'owner', 'playlist', 'Listen'),
        (${randomUUID()}, 'owner', 'playlist', 'Listen')
    `;
      expect((await service.lists('owner')).lists).toHaveLength(3);
    });

    test('adds unique episode IDs, preserves time on repeated adds and deletes rows', async () => {
      const first = await service.change(
        'owner',
        listId,
        batch([add(101), add(201), add(101)]),
      );
      expect(first.revision).toBe('1');
      expect(first.results.map(({ status }) => status)).toEqual([
        'applied',
        'applied',
        'unchanged',
      ]);
      const snapshot = await service.membership('owner', listId);
      expect(snapshot.items).toHaveLength(2);
      await sql`UPDATE podcasts SET feed_url = 'https://moved.example.invalid/rss' WHERE id = 1`;
      expect(
        (await service.change('owner', listId, batch([add(101)]))).revision,
      ).toBe('1');
      expect(await service.membership('owner', listId)).toEqual(snapshot);
      expect(
        (
          await service.change(
            'owner',
            listId,
            batch([remove(101), remove(101), remove(999)]),
          )
        ).results.map(({ status }) => status),
      ).toEqual(['applied', 'unchanged', 'unchanged']);
      expect(
        await sql`SELECT * FROM episode_list_items WHERE episode_id = 101`,
      ).toHaveLength(0);
      await sql`UPDATE episode_list_items SET added_at = '2020-01-01' WHERE episode_id = 201`;
      await service.change('owner', listId, batch([remove(201), add(201)]));
      expect(
        (await service.membership('owner', listId)).items[0].addedAt,
      ).toBeGreaterThan(Date.UTC(2020, 0, 1));
    });

    test('deduplicates a lost-response retry after an intervening removal', async () => {
      const request = batch([add(101)]);
      const original = await service.change('owner', listId, request);
      await service.change('owner', listId, batch([remove(101)]));
      expect(await service.change('owner', listId, request)).toEqual(original);
      expect(await service.membership('owner', listId)).toEqual({
        ...scope(),
        listId,
        revision: '2',
        items: [],
      });
      await service.change(
        'owner',
        listId,
        batch([add(101)], request.clientId, '2'),
      );
      expect((await service.membership('owner', listId)).items).toHaveLength(1);
    });

    test('limits only new streams and rolls back denied registrations', async () => {
      let registrations = 0;
      const limited = createEpisodeListService(sql, async () => {
        registrations++;
        if (registrations === 1) throw new Error('Registration refused');
      });
      const request = batch([add(101)]);
      await expect(limited.change('owner', listId, request)).rejects.toThrow(
        'Registration refused',
      );
      expect(await sql`SELECT * FROM episode_list_clients`).toHaveLength(0);
      expect((await service.membership('owner', listId)).items).toEqual([]);
      await limited.change('owner', listId, request);
      await limited.change('owner', listId, request);
      await limited.change('owner', listId, { ...request, sequence: '2' });
      expect(registrations).toBe(2);
    });

    test('concurrent retries apply a batch once', async () => {
      const request = batch([add(101)]);
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          service.change('owner', listId, request),
        ),
      );
      for (const result of results) expect(result).toEqual(results[0]);
      expect((await service.membership('owner', listId)).revision).toBe('1');
    });

    test('rejects changed, skipped and retired stream requests', async () => {
      const request = batch([add(101)]);
      await expect(
        service.change('owner', listId, { ...request, sequence: '2' }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await sql`SELECT * FROM episode_list_clients`).toHaveLength(0);
      await service.change('owner', listId, request);
      await expect(
        service.change('owner', listId, { ...request, changes: [remove(101)] }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service.change('owner', listId, { ...request, sequence: '3' }),
      ).rejects.toMatchObject({ status: 409 });
      await service.change('owner', listId, { ...request, sequence: '2' });
      await expect(
        service.change('owner', listId, request),
      ).rejects.toMatchObject({ status: 409 });
    });

    test('handles revisions and sequences beyond JavaScript integer precision', async () => {
      const request = batch([add(101)]);
      await service.change('owner', listId, request);
      await sql`UPDATE episode_lists SET revision = 9007199254740992 WHERE id = ${listId}`;
      await sql`UPDATE episode_list_clients SET last_sequence = 9007199254740992 WHERE client_id = ${request.clientId}`;
      const result = await service.change('owner', listId, {
        ...request,
        sequence: '9007199254740993',
        changes: [remove(101)],
      });
      expect(result.sequence).toBe('9007199254740993');
      expect(result.revision).toBe('9007199254740993');
      expect((await service.membership('owner', listId)).revision).toBe(
        result.revision,
      );
    });

    test('inaccessible and missing additions fail without disclosing private metadata', async () => {
      const result = await service.change(
        'owner',
        listId,
        batch([add(301), add(999), remove(301), add(102)]),
      );
      expect(result.results.map(({ status }) => status)).toEqual([
        'not_found',
        'not_found',
        'unchanged',
        'applied',
      ]);
      const page = await service.episodes('owner', listId, { limit: 10 });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        episodeId: '102',
        availability: 'content_missing',
        episode: null,
      });
      expect(JSON.stringify(page)).not.toContain('other.example');
    });

    test('retains revoked memberships as removable placeholders', async () => {
      await service.change('owner', listId, batch([add(101)]));
      await sql`UPDATE podcasts SET owner_user_id = 'other' WHERE id = 1`;
      const snapshot = await service.membership('owner', listId);
      expect(snapshot.items[0].availability).toBe('unavailable');
      const page = await service.episodes('owner', listId, { limit: 10 });
      expect(page.items[0]).toMatchObject({
        episodeId: '101',
        availability: 'unavailable',
        episode: null,
      });
      expect(JSON.stringify(page)).not.toContain('Public episode');
      expect((await service.lists('owner')).lists[0].itemCount).toBe(1);
      await service.change('owner', listId, batch([remove(101)]));
      expect((await service.membership('owner', listId)).items).toEqual([]);
    });

    test('returns a full compact snapshot and keyset-paginates hydration', async () => {
      await sql`
      INSERT INTO episodes (id, podcast_id, guid, published)
      SELECT n, 1, n::text, now() FROM generate_series(1000, 1204) n
    `;
      await sql`
      INSERT INTO episode_list_items (list_id, episode_id, added_at)
      SELECT ${listId}, id, '2026-01-01T00:00:00.123Z' FROM episodes WHERE id >= 1000
    `;
      expect((await service.membership('owner', listId)).items).toHaveLength(
        205,
      );
      const first = await service.episodes('owner', listId, { limit: 200 });
      expect(first.items).toHaveLength(200);
      expect(first.items[0].episodeId).toBe('1204');
      const cursor = parseListCursor(first.nextCursor ?? '', listId);
      if (!cursor) throw new Error('Expected next page cursor');
      expect(cursor.addedAt).toBe(Date.parse('2026-01-01T00:00:00.123Z'));
      await service.change('owner', listId, batch([remove(1002), add(101)]));
      const second = await service.episodes('owner', listId, {
        limit: 200,
        cursor,
      });
      expect(second.items.map(({ episodeId }) => episodeId)).toEqual([
        '1004',
        '1003',
        '1001',
        '1000',
      ]);
      expect(second.nextCursor).toBeNull();
      expect(second.revision).toBe('1');
    });

    test('round-trips bigint identities through membership, hydration and moves', async () => {
      const episodeId = '9007199254740993';
      const podcastId = '9223372036854775807';
      await sql`INSERT INTO podcasts (id, author_id, feed_url, title, cover) VALUES (${podcastId}, 1, 'https://exact.example.invalid/rss', 'Exact', 'cover')`;
      await sql`INSERT INTO episodes (id, podcast_id, guid, published) VALUES (${episodeId}, ${podcastId}, 'shared', now())`;
      await sql`INSERT INTO episode_content (episode_id, title, file_url) VALUES (${episodeId}, 'Exact episode', 'https://exact.example.invalid/audio')`;
      const ack = await service.change(
        'owner',
        listId,
        batch([add(episodeId)]),
      );
      expect(ack.results[0].episodeId).toBe(episodeId);
      expect(
        (await service.membership('owner', listId)).items[0].episodeId,
      ).toBe(episodeId);
      await sql`UPDATE podcasts SET feed_url = 'https://moved.example.invalid/rss' WHERE id = ${podcastId}`;
      await sql`UPDATE episode_content SET file_url = 'https://moved.example.invalid/audio' WHERE episode_id = ${episodeId}`;
      const item = (await service.episodes('owner', listId, { limit: 1 }))
        .items[0];
      expect(item.episode?.id).toBe(episodeId);
      expect(item.episode?.podcastId).toBe(podcastId);
      expect(item.episode?.file.url).toBe(
        'https://moved.example.invalid/audio',
      );
    });

    test('hydrates the existing episode contract', async () => {
      await service.change('owner', listId, batch([add(201)]));
      expect(
        (await service.episodes('owner', listId, { limit: 1 })).items[0]
          .episode,
      ).toEqual({
        id: '201',
        podcastId: '2',
        isPrivate: true,
        guid: 'shared',
        feed: 'https://owner.example.invalid/secret',
        podcastTitle: 'Private',
        title: 'Private episode',
        summary: null,
        showNotes: '',
        published: Date.UTC(2026, 0, 1),
        duration: null,
        episodeArt: null,
        cover: 'cover',
        explicit: false,
        author: 'Author',
        link: null,
        file: {
          url: 'https://owner.example.invalid/secret.mp3',
          length: 0,
          type: 'audio/mpeg',
        },
      });
    });

    test('rolls back memberships, revision and stream acknowledgement together', async () => {
      await sql`ALTER TABLE episode_list_items ADD CONSTRAINT reject_episode CHECK (episode_id <> 103)`;
      const request = batch([add(101), add(103)]);
      try {
        await expect(
          service.change('owner', listId, request),
        ).rejects.toMatchObject({ code: '23514' });
        expect((await service.membership('owner', listId)).items).toEqual([]);
        expect((await service.membership('owner', listId)).revision).toBe('0');
        expect(await sql`SELECT * FROM episode_list_clients`).toHaveLength(0);
      } finally {
        await sql`ALTER TABLE episode_list_items DROP CONSTRAINT reject_episode`;
      }
      expect(
        (await service.change('owner', listId, request)).results.every(
          ({ status }) => status === 'applied',
        ),
      ).toBe(true);
    });

    test('blocks destructive catalogue deletion but cascades account-owned data', async () => {
      await service.change('owner', listId, batch([add(101), add(201)]));
      await expect(
        Promise.resolve(sql`DELETE FROM episodes WHERE id = 101`),
      ).rejects.toMatchObject({ code: '23503' });
      await sql`DELETE FROM users WHERE id = 'owner'`;
      expect(await sql`SELECT * FROM episode_lists`).toHaveLength(0);
      expect(await sql`SELECT * FROM episode_list_items`).toHaveLength(0);
      expect(await sql`SELECT * FROM episode_list_clients`).toHaveLength(0);
      expect(await sql`SELECT * FROM episodes WHERE id = 201`).toHaveLength(0);
      expect(await sql`SELECT * FROM episodes WHERE id = 101`).toHaveLength(1);
    });
  },
);
