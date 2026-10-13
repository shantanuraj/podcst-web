import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { resolve } from 'node:path';
import { startPostgres } from './lib/postgres-sandbox';
import { createSchemaFixture } from './lib/schema-fixture';
import {
  changeEgressBlock,
  EgressBlockError,
  parseEgressBlockArgs,
} from './mark-egress-blocked';

const evidence =
  '403 from sixth-1 for three user agents; 200 and 100 episodes from a second vantage point';

describe('egress block arguments', () => {
  test('dry run is the default and apply is explicit', () => {
    expect(
      parseEgressBlockArgs(['mark', '14477', '--evidence', evidence]),
    ).toEqual({
      change: { action: 'mark', podcastId: '14477', evidence },
      apply: false,
    });
    expect(parseEgressBlockArgs(['unmark', '14477', '--apply'])).toEqual({
      change: { action: 'unmark', podcastId: '14477' },
      apply: true,
    });
  });

  test('rejects malformed invocations', () => {
    for (const args of [
      [],
      ['mark', '14477'],
      ['mark', '14477', '--apply'],
      ['mark', 'x', '--evidence', evidence],
      ['mark', '0', '--evidence', evidence],
      ['mark', '14477', '--evidence', evidence, '--force'],
      ['unmark', '14477', '--evidence', evidence],
      ['clear', '14477'],
    ])
      expect(() => parseEgressBlockArgs(args)).toThrow(EgressBlockError);
  });
});

describe.skipIf(!process.env.PG_BIN)(
  'egress block marking on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;

    const state = async () =>
      Array.from(
        await cluster.sql`
          SELECT podcast_id::text, egress_blocked_at IS NOT NULL AS marked,
                 egress_block_evidence, failures, last_error_kind
          FROM feed_poll_state ORDER BY podcast_id
        `,
      );

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
        INSERT INTO users(id,email) VALUES ('owner','owner@example.invalid');
        INSERT INTO podcasts(id,feed_url,title,author_id,cover,owner_user_id) VALUES
          (14477,'http://feeds.example.invalid/blocked','Blocked',1,'cover',NULL),
          (14478,'https://feeds.example.invalid/unpolled','Unpolled',1,'cover',NULL),
          (14479,'https://feeds.example.invalid/private?token=secret','Private',1,'cover','owner');
        INSERT INTO feed_poll_state(podcast_id,failures,last_error_kind,last_error_status,last_error_at,failing_since)
        VALUES (14477,4,'http_auth',403,now(),now()),(14479,1,'http_auth',403,now(),now());
      `);
    });

    test('the migration constrains the mark to a timestamp with a bounded note', async () => {
      const { sql } = cluster;
      for (const [at, note] of [
        ['now()', 'NULL'],
        ['NULL', "'note'"],
        ['now()', "''"],
        ['now()', `'${'x'.repeat(201)}'`],
        ['now()', "' padded'"],
        ['now()', "E'two\\nlines'"],
        ['now()', "'see https://feeds.example.invalid/blocked'"],
        ['now()', "'FEED://example.invalid'"],
      ])
        await expect(
          (async () => {
            await sql.unsafe(
              `UPDATE feed_poll_state SET egress_blocked_at = ${at}, egress_block_evidence = ${note} WHERE podcast_id = 14477`,
            );
          })(),
        ).rejects.toThrow('feed_egress_block');
      await sql`
        UPDATE feed_poll_state SET egress_blocked_at = now(), egress_block_evidence = ${'x'.repeat(200)}
        WHERE podcast_id = 14477
      `;
      const [index] = await sql`
        SELECT pg_get_indexdef('feed_egress_blocked'::regclass) AS definition
      `;
      expect(index.definition).toContain(
        '(podcast_id) WHERE (egress_blocked_at IS NOT NULL)',
      );
    });

    test('dry run reports the change and rolls it back', async () => {
      const before = await state();
      const result = await changeEgressBlock(cluster.sql, {
        action: 'mark',
        podcastId: '14477',
        evidence,
      });
      expect(result).toMatchObject({
        status: 'rolled_back',
        action: 'mark',
        podcast: { id: '14477', title: 'Blocked' },
        before: {
          egress_blocked_at: null,
          egress_block_evidence: null,
          failures: 4,
          last_error_kind: 'http_auth',
          last_error_status: 403,
        },
        after: { egress_block_evidence: evidence, failures: 4 },
      });
      expect(result?.after.egress_blocked_at).toBeInstanceOf(Date);
      expect(await state()).toEqual(before);
    });

    test('apply marks one row, keeps poll backoff and re-marking replaces the note', async () => {
      await changeEgressBlock(
        cluster.sql,
        { action: 'mark', podcastId: '14477', evidence },
        true,
      );
      expect(await state()).toEqual([
        {
          podcast_id: '14477',
          marked: true,
          egress_block_evidence: evidence,
          failures: 4,
          last_error_kind: 'http_auth',
        },
        {
          podcast_id: '14479',
          marked: false,
          egress_block_evidence: null,
          failures: 1,
          last_error_kind: 'http_auth',
        },
      ]);
      const result = await changeEgressBlock(
        cluster.sql,
        { action: 'mark', podcastId: '14477', evidence: 'Re-probed' },
        true,
      );
      expect(result?.before.egress_block_evidence).toBe(evidence);
      expect((await state())[0].egress_block_evidence).toBe('Re-probed');
    });

    test('marking a never-polled podcast creates its poll state row', async () => {
      await changeEgressBlock(
        cluster.sql,
        { action: 'mark', podcastId: '14478', evidence },
        true,
      );
      expect(
        (await state()).map((row) => [row.podcast_id, row.marked]),
      ).toEqual([
        ['14477', false],
        ['14478', true],
        ['14479', false],
      ]);
    });

    test('unmark clears only the mark and refuses an unmarked podcast', async () => {
      await changeEgressBlock(
        cluster.sql,
        { action: 'mark', podcastId: '14477', evidence },
        true,
      );
      const dry = await changeEgressBlock(cluster.sql, {
        action: 'unmark',
        podcastId: '14477',
      });
      expect(dry?.status).toBe('rolled_back');
      expect((await state())[0].marked).toBe(true);
      const result = await changeEgressBlock(
        cluster.sql,
        { action: 'unmark', podcastId: '14477' },
        true,
      );
      expect(result).toMatchObject({
        status: 'committed',
        after: {
          egress_blocked_at: null,
          egress_block_evidence: null,
          failures: 4,
        },
      });
      await expect(
        changeEgressBlock(
          cluster.sql,
          { action: 'unmark', podcastId: '14477' },
          true,
        ),
      ).rejects.toThrow('not marked');
      await expect(
        changeEgressBlock(cluster.sql, {
          action: 'unmark',
          podcastId: '14478',
        }),
      ).rejects.toThrow('not marked');
    });

    test('refuses private, missing and unsafe evidence without writing', async () => {
      const before = await state();
      for (const [change, message] of [
        [{ podcastId: '14479', evidence }, 'Private podcasts cannot be marked'],
        [{ podcastId: '99999', evidence }, 'Podcast not found'],
        [
          { podcastId: '14477', evidence: 'http://feeds.example.invalid/x' },
          'without URLs',
        ],
        [{ podcastId: '14477', evidence: '' }, 'without URLs'],
        [{ podcastId: '14477', evidence: 'x'.repeat(201) }, 'without URLs'],
      ] as const)
        await expect(
          changeEgressBlock(cluster.sql, { action: 'mark', ...change }, true),
        ).rejects.toThrow(message);
      expect(await state()).toEqual(before);
    });

    test('the command requires an explicit database and prints the plan', () => {
      const run = (args: string[], url?: string) =>
        Bun.spawnSync(
          [
            process.execPath,
            resolve('scripts/mark-egress-blocked.ts'),
            ...args,
          ],
          {
            env: {
              ...process.env,
              EGRESS_DATABASE_URL: url ?? '',
              DATABASE_URL: 'postgres://must-not-be-used.invalid/app',
            },
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
      const missing = run(['mark', '14477', '--evidence', evidence]);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr.toString()).toContain(
        'EGRESS_DATABASE_URL must explicitly select the target database',
      );
      const dry = run(['mark', '14477', '--evidence', evidence], cluster.url);
      expect(dry.exitCode).toBe(0);
      expect(JSON.parse(dry.stdout.toString())).toMatchObject({
        status: 'rolled_back',
        podcast: { id: '14477' },
      });
      const refused = run(
        ['mark', '14479', '--evidence', evidence, '--apply'],
        cluster.url,
      );
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr.toString().trim()).toBe(
        'Private podcasts cannot be marked',
      );
      expect(refused.stdout.toString()).toBe('');
    });
  },
);
