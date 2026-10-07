import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import type { FollowBatch, ProgressBatch } from '@/shared/state-contract';
import { stateValidator } from '@/shared/state-contract';
import fixtures from '../../../contracts/state/fixtures.json';
import transitions from '../../../contracts/state/transitions.json';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { legacyListHash } from '../lists/legacy';
import { createEpisodeListService } from '../lists/service';
import { createFollowStateService } from './follows';
import { createProgressStateService } from './progress';

const migration = readFileSync(
  new URL('../../../migrations/staged/0010-durable-state.sql', import.meta.url),
  'utf8',
);
const accountId = fixtures.progressBatch.accountId;
const generation = fixtures.progressBatch.generation;
const first = '9007199254740993';
const second = '9007199254740994';
const hidden = '9223372036854775807';
const clients = {
  a: fixtures.progressBatch.clientId,
  b: '00000000-0000-0000-0000-000000000001',
};
const stream = (clientId: string = randomUUID(), sequence = '1') => ({
  protocol: 1 as const,
  accountId,
  generation,
  clientId,
  sequence,
});
const batch = (
  positionSeconds = 90,
  completed = false,
  clientId: string = randomUUID(),
  sequence = '1',
): ProgressBatch => ({
  ...stream(clientId, sequence),
  changes: [{ episodeId: first, positionSeconds, completed }],
});
const follow = (
  followed = true,
  clientId: string = randomUUID(),
  sequence = '1',
): FollowBatch => ({
  ...stream(clientId, sequence),
  changes: [{ podcastId: first, followed }],
});

async function seed(sql: postgres.Sql) {
  await sql`INSERT INTO users (id, email) VALUES (${accountId}, 'a@example.invalid'), ('other', 'b@example.invalid')`;
  await sql`INSERT INTO authors (id, name) VALUES (1, 'Author')`;
  await sql`
    INSERT INTO podcasts (id, author_id, feed_url, title, cover, owner_user_id) VALUES
      (${first}, 1, 'https://a.example.invalid/rss', 'A', 'cover', NULL),
      (${second}, 1, 'https://b.example.invalid/rss', 'B', 'cover', NULL),
      (${hidden}, 1, 'https://private.example.invalid/rss', 'Private', 'cover', 'other')
  `;
  await sql`
    INSERT INTO episodes (id, podcast_id, guid, published) VALUES
      (${first}, ${first}, 'shared-guid', '2026-01-01'),
      (${second}, ${second}, 'shared-guid', '2026-01-02'),
      (${hidden}, ${hidden}, 'shared-guid', '2026-01-03')
  `;
  await sql`
    INSERT INTO episode_content (episode_id, title, file_url) VALUES
      (${first}, 'A', 'https://a.example.invalid/audio.mp3'),
      (${second}, 'B', 'https://b.example.invalid/audio.mp3'),
      (${hidden}, 'Private', 'https://private.example.invalid/audio.mp3')
  `;
}

describe.skipIf(!process.env.PG_BIN)(
  'durable resource services on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let progress: ReturnType<typeof createProgressStateService>;
    let follows: ReturnType<typeof createFollowStateService>;

    beforeAll(async () => {
      cluster = startPostgres();
      sql = postgres({ ...cluster.options, max: 8 });
      await createSchemaFixture(sql);
      await sql.begin((tx) => tx.unsafe(migration));
      progress = createProgressStateService(sql);
      follows = createFollowStateService(sql);
    }, 30_000);

    afterAll(async () => {
      await sql?.end();
      await cluster?.stop();
    });

    beforeEach(async () => {
      await sql`TRUNCATE users, authors RESTART IDENTITY CASCADE`;
      await sql`UPDATE state_generation SET generation = ${generation}, legacy_generation = ${generation}`;
      await seed(sql);
    });

    test('executes shared progress lost-ack/opposite-action, rewind and relisten vectors', async () => {
      for (const step of transitions.progress) {
        const ack = await progress.change(accountId, {
          ...stream(
            clients[step.client as keyof typeof clients],
            step.sequence,
          ),
          changes: step.changes,
        });
        expect(stateValidator('progressAcknowledgement')(ack)).toBe(true);
        expect(ack.revision).toBe(step.ackRevision);
        const snapshot = await progress.read(accountId, [first]);
        expect(stateValidator('progressSnapshot')(snapshot)).toBe(true);
        expect(snapshot.revision).toBe(step.headRevision);
        expect(snapshot.items[0].progress).toMatchObject({
          positionSeconds: step.positionSeconds,
          completed: step.completed,
        });
        expect(
          (await progress.recent(accountId, 1)).items[0]?.episodeId ?? null,
        ).toBe(step.currentEpisodeId);
      }
    });

    test('executes shared follow lost-ack/opposite-action vectors without resurrection', async () => {
      for (const step of transitions.follows) {
        const ack = await follows.change(accountId, {
          ...stream(
            clients[step.client as keyof typeof clients],
            step.sequence,
          ),
          changes: step.changes,
        });
        expect(stateValidator('followAcknowledgement')(ack)).toBe(true);
        expect(ack.revision).toBe(step.ackRevision);
        const snapshot = await follows.read(accountId);
        expect(stateValidator('followSnapshot')(snapshot)).toBe(true);
        expect(snapshot.revision).toBe(step.headRevision);
        expect(
          snapshot.items.some(({ podcastId }) => podcastId === first),
        ).toBe(step.followed);
      }
    });

    test('replays concurrent identical batches once and serializes different clients by accepted revision', async () => {
      const frozen = batch();
      const retries = await Promise.all(
        Array.from({ length: 8 }, () => progress.change(accountId, frozen)),
      );
      for (const ack of retries) expect(ack).toEqual(retries[0]);
      expect((await progress.read(accountId, [first])).revision).toBe('1');
      const accepted = await Promise.all(
        Array.from({ length: 8 }, async (_, index) => ({
          index,
          ack: await progress.change(accountId, batch(index)),
        })),
      );
      const latest = accepted.reduce((a, b) =>
        BigInt(a.ack.revision) > BigInt(b.ack.revision) ? a : b,
      );
      expect(
        (await progress.read(accountId, [first])).items[0].progress
          ?.positionSeconds,
      ).toBe(latest.index);
      expect(new Set(accepted.map(({ ack }) => ack.revision)).size).toBe(8);
      expect(latest.ack.revision).toBe('9');
    });

    test('serializes simultaneous follow and unfollow and isolates resource streams', async () => {
      const frozen = follow();
      const retries = await Promise.all(
        Array.from({ length: 8 }, () => follows.change(accountId, frozen)),
      );
      for (const ack of retries) expect(ack).toEqual(retries[0]);
      const results = await Promise.all(
        Array.from({ length: 8 }, async (_, i) => ({
          followed: i % 2 === 0,
          ack: await follows.change(accountId, follow(i % 2 === 0)),
        })),
      );
      const latest = results.reduce((a, b) =>
        BigInt(a.ack.revision) > BigInt(b.ack.revision) ? a : b,
      );
      expect((await follows.read(accountId)).items.length).toBe(
        latest.followed ? 1 : 0,
      );
      expect(
        (await progress.change(accountId, batch(1, false, frozen.clientId)))
          .revision,
      ).toBe('1');
    });

    test('rejects changed, old and skipped sequences without touching state', async () => {
      const firstBatch = batch();
      await progress.change(accountId, firstBatch);
      for (const changed of [
        {
          ...firstBatch,
          changes: [{ ...firstBatch.changes[0], positionSeconds: 89 }],
        },
        { ...firstBatch, sequence: '3' },
      ])
        await expect(progress.change(accountId, changed)).rejects.toMatchObject(
          { code: 'sequence_conflict' },
        );
      await progress.change(accountId, { ...firstBatch, sequence: '2' });
      await expect(
        progress.change(accountId, firstBatch),
      ).rejects.toMatchObject({ code: 'sequence_conflict' });
      expect((await progress.read(accountId, [first])).revision).toBe('2');
    });

    test('preserves timestamps and revisions on replay but orders genuinely new unchanged actions', async () => {
      const frozen = batch();
      const ack = await progress.change(accountId, frozen);
      const before = await progress.read(accountId, [first]);
      expect(await progress.change(accountId, frozen)).toEqual(ack);
      expect(await progress.read(accountId, [first])).toEqual(before);
      const next = await progress.change(accountId, {
        ...frozen,
        sequence: '2',
      });
      expect(next.results[0].status).toBe('unchanged');
      expect(next.revision).toBe('2');
      const membership = follow();
      await follows.change(accountId, membership);
      const time = (await follows.read(accountId)).items[0].followedAtMs;
      await follows.change(accountId, { ...membership, sequence: '2' });
      expect((await follows.read(accountId)).items[0].followedAtMs).toBe(time);
    });

    test('keeps explicit completion independent of position and orders actions within a batch', async () => {
      const request = {
        ...stream(),
        changes: [
          { episodeId: first, positionSeconds: 95, completed: false },
          { episodeId: first, positionSeconds: 0, completed: true },
          { episodeId: second, positionSeconds: 100, completed: true },
        ],
      };
      expect((await progress.change(accountId, request)).revision).toBe('3');
      expect((await progress.recent(accountId, 10)).items).toEqual([]);
      const read = await progress.read(accountId, [first, second]);
      expect(read.items[0].progress).toMatchObject({
        positionSeconds: 0,
        completed: true,
        revision: '2',
      });
      expect(read.items[1].progress).toMatchObject({
        completed: true,
        revision: '3',
      });
      await progress.change(accountId, batch(0, false));
      expect((await progress.recent(accountId, 1)).items[0].episodeId).toBe(
        first,
      );
    });

    test('keeps canonical identities across feed and enclosure changes and shared GUIDs', async () => {
      await progress.change(accountId, {
        ...batch(),
        changes: [
          { episodeId: first, positionSeconds: 12, completed: false },
          { episodeId: second, positionSeconds: 34, completed: false },
        ],
      });
      await sql`UPDATE podcasts SET feed_url = 'https://moved.example.invalid/rss' WHERE id = ${first}`;
      await sql`UPDATE episode_content SET file_url = 'https://moved.example.invalid/audio' WHERE episode_id = ${first}`;
      const read = await progress.read(accountId, [first, second]);
      expect(
        read.items.map((item) => [
          item.episodeId,
          item.progress?.positionSeconds,
        ]),
      ).toEqual([
        [first, 12],
        [second, 34],
      ]);
    });

    test('hides inaccessible state and allows owned references to be unfollowed', async () => {
      const ack = await progress.change(accountId, {
        ...batch(),
        changes: [{ episodeId: hidden, positionSeconds: 1, completed: false }],
      });
      expect(ack.revision).toBe('0');
      expect(ack.results[0].status).toBe('not_found');
      expect(
        (await progress.read(accountId, [hidden, first])).items.map(
          (item) => item.progress,
        ),
      ).toEqual([null, null]);
      expect(
        (
          await follows.change(accountId, {
            ...follow(),
            changes: [{ podcastId: hidden, followed: true }],
          })
        ).results[0].status,
      ).toBe('not_found');
      await follows.change(accountId, follow());
      await sql`UPDATE podcasts SET owner_user_id = 'other' WHERE id = ${first}`;
      expect((await follows.read(accountId)).items[0].availability).toBe(
        'unavailable',
      );
      expect(
        (await follows.change(accountId, follow(false))).results[0].status,
      ).toBe('applied');
      expect((await follows.read(accountId)).items).toEqual([]);
      expect(
        (
          await follows.change(accountId, {
            ...follow(),
            changes: [{ podcastId: '123', followed: false }],
          })
        ).results[0].status,
      ).toBe('unchanged');
    });

    test('fences account changes, expiry and restored generations even on an exact replay', async () => {
      const frozen = batch();
      const ack = await progress.change(accountId, frozen);
      await expect(progress.change('other', frozen)).rejects.toMatchObject({
        code: 'account_mismatch',
      });
      expect(await progress.change(accountId, frozen)).toEqual(ack);
      await sql`UPDATE state_generation SET generation = ${randomUUID()}`;
      await expect(progress.change(accountId, frozen)).rejects.toMatchObject({
        code: 'recovery_required',
      });
      await expect(
        progress.change(accountId, { ...frozen, sequence: '2' }),
      ).rejects.toMatchObject({ code: 'recovery_required' });
      await sql`UPDATE state_generation SET generation = ${generation}`;
      await sql`DELETE FROM users WHERE id = ${accountId}`;
      await expect(progress.change(accountId, frozen)).rejects.toMatchObject({
        code: 'unauthenticated',
      });
      expect(await sql`SELECT * FROM progress_clients`).toHaveLength(0);
    });

    test('rolls effects, heads and stream registration back when acknowledgement persistence fails', async () => {
      await sql.unsafe(
        `CREATE FUNCTION fail_state_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER fail_state_ack BEFORE UPDATE ON progress_clients FOR EACH ROW EXECUTE FUNCTION fail_state_ack()`,
      );
      try {
        await expect(progress.change(accountId, batch())).rejects.toThrow(
          'synthetic failure',
        );
        expect(await sql`SELECT * FROM playback_progress`).toHaveLength(0);
        expect(await sql`SELECT * FROM progress_revision_heads`).toHaveLength(
          0,
        );
        expect(await sql`SELECT * FROM progress_clients`).toHaveLength(0);
      } finally {
        await sql`DROP TRIGGER fail_state_ack ON progress_clients`;
        await sql`DROP FUNCTION fail_state_ack()`;
      }
    });

    test('rolls follow removals and revisions back when saving the acknowledgement fails', async () => {
      await follows.change(accountId, follow());
      const before = await follows.read(accountId);
      await sql.unsafe(
        `CREATE FUNCTION fail_follow_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER fail_follow_ack BEFORE UPDATE ON follow_clients FOR EACH ROW EXECUTE FUNCTION fail_follow_ack()`,
      );
      try {
        await expect(follows.change(accountId, follow(false))).rejects.toThrow(
          'synthetic failure',
        );
        expect(await follows.read(accountId)).toEqual(before);
        expect(await sql`SELECT * FROM follow_clients`).toHaveLength(1);
      } finally {
        await sql`DROP TRIGGER fail_follow_ack ON follow_clients`;
        await sql`DROP FUNCTION fail_follow_ack()`;
      }
    });

    test('rolls back a whole batch on revision exhaustion without reusing identities', async () => {
      await sql`INSERT INTO progress_revision_heads VALUES (${accountId}, 9223372036854775806)`;
      const change = batch();
      change.changes.push({
        episodeId: second,
        positionSeconds: 12,
        completed: false,
      });
      await expect(progress.change(accountId, change)).rejects.toMatchObject({
        code: 'recovery_required',
      });
      expect(await sql`SELECT * FROM playback_progress`).toHaveLength(0);
      expect(await sql`SELECT * FROM progress_clients`).toHaveLength(0);
      expect((await progress.read(accountId, [first])).revision).toBe(
        '9223372036854775806',
      );
    });

    test('bounds per-episode reads and rejects unvalidated writes before allocating streams', async () => {
      for (const ids of [
        [],
        [first, first],
        ['01'],
        Array.from({ length: 201 }, (_, i) => String(i + 1)),
      ])
        await expect(progress.read(accountId, ids)).rejects.toMatchObject({
          code: 'invalid_request',
        });
      for (const limit of [0, 11, 1.5])
        await expect(progress.recent(accountId, limit)).rejects.toMatchObject({
          code: 'invalid_request',
        });
      await expect(progress.change(accountId, batch(-1))).rejects.toMatchObject(
        { code: 'invalid_request' },
      );
      expect(await sql`SELECT * FROM progress_clients`).toHaveLength(0);
    });

    test.each([
      true,
      false,
    ])('preserves a frozen numeric Starred batch when already accepted is %s', async (accepted) => {
      await sql`INSERT INTO episodes (id, podcast_id, guid, published) VALUES (101, ${first}, 'legacy', '2025-01-01')`;
      const lists = createEpisodeListService(sql);
      const listId = (await lists.lists(accountId)).lists[0].id;
      const frozen = {
        clientId: randomUUID(),
        sequence: '1',
        changes: [{ op: 'add' as const, episodeId: 101 }],
      };
      const source = JSON.stringify(frozen);
      const originalHash = legacyListHash(listId, frozen);
      const scope = { protocol: 1 as const, accountId, generation };
      const originalAck = await lists.change(
        accountId,
        listId,
        frozen,
        accepted ? undefined : scope,
      );
      await lists.change(accountId, listId, {
        clientId: randomUUID(),
        sequence: '1',
        changes: [{ op: 'remove', episodeId: 101 }],
      });
      const replay = await lists.change(
        accountId,
        listId,
        JSON.parse(source),
        scope,
      );
      expect(replay).toEqual(originalAck);
      expect(replay.results[0].episodeId).toBe(101);
      expect((await lists.membership(accountId, listId)).items).toEqual([]);
      const [stored] =
        await sql`SELECT last_sequence::text, last_request_hash, last_result FROM episode_list_clients WHERE user_id = ${accountId} AND client_id = ${frozen.clientId}`;
      expect(stored.last_sequence).toBe('1');
      expect(stored.last_request_hash).toBe(originalHash);
      expect(stored.last_result).toEqual(originalAck);
      const converted = JSON.parse(source);
      converted.changes[0].episodeId = '101';
      expect(legacyListHash(listId, converted)).not.toBe(originalHash);
      expect(JSON.stringify(frozen)).toBe(source);
      await expect(
        lists.change('other', listId, frozen, scope),
      ).rejects.toMatchObject({ code: 'account_mismatch' });
      const restoredGeneration = randomUUID();
      await sql`UPDATE state_generation SET generation = ${restoredGeneration}`;
      await expect(
        lists.change(accountId, listId, frozen, {
          ...scope,
          generation: restoredGeneration,
        }),
      ).rejects.toMatchObject({ code: 'recovery_required' });
    });

    test('upgrades populated state without dropping positions, completion or ordering', async () => {
      await sql`CREATE DATABASE state_upgrade`;
      const upgrade = postgres({
        ...cluster.options,
        database: 'state_upgrade',
      });
      try {
        await createSchemaFixture(upgrade);
        await seed(upgrade);
        await upgrade`
        INSERT INTO playback_progress (user_id, episode_id, position, completed, updated_at) VALUES
          (${accountId}, ${first}, 25, true, '2025-01-02'), (${accountId}, ${second}, 12, false, NULL)
      `;
        await upgrade`INSERT INTO subscriptions (user_id, podcast_id, subscribed_at) VALUES (${accountId}, ${first}, NULL)`;
        await upgrade.begin((tx) => tx.unsafe(migration));
        const service = createProgressStateService(upgrade);
        const snapshot = await service.read(accountId, [first, second]);
        expect(snapshot.revision).toBe('2');
        expect(snapshot.items[0].progress).toMatchObject({
          positionSeconds: 25,
          completed: true,
          revision: '2',
        });
        expect(snapshot.items[1].progress).toMatchObject({
          positionSeconds: 12,
          completed: false,
          revision: '1',
        });
        const library = await createFollowStateService(upgrade).read(accountId);
        expect(library.items[0].podcastId).toBe(first);
        expect(library.revision).toBe('1');
        expect(library.items[0].followedAtMs).toBeNull();
        expect(snapshot.items[1].progress?.updatedAtMs).toBeNull();
        expect(stateValidator('uuid')(snapshot.generation)).toBe(true);
      } finally {
        await upgrade.end();
        await sql`DROP DATABASE state_upgrade`;
      }
    });
  },
);
