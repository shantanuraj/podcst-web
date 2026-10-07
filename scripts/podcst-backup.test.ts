import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEpisodeListService } from '@/server/lists/service';
import type { ListBatch } from '@/shared/lists';
import { startPostgres } from './lib/postgres-sandbox';
import { createSchemaFixture } from './lib/schema-fixture';

const script = readFileSync(
  new URL('./podcst-backup.sh', import.meta.url),
  'utf8',
);
const tables = [...script.matchAll(/-t (public\.[a-z_]+)/g)].map(
  (match) => match[1],
);

test('selected backup covers durable account, alias, list and chart state exactly once', () => {
  expect(tables.toSorted()).toEqual([
    'public.account_preferences',
    'public.chart_history',
    'public.email_verifications',
    'public.episode_list_clients',
    'public.episode_list_items',
    'public.episode_lists',
    'public.passkeys',
    'public.playback_progress',
    'public.podcast_apple_aliases',
    'public.podcast_feed_aliases',
    'public.sessions',
    'public.subscriptions',
    'public.transcripts',
    'public.users',
  ]);
  expect(script).toContain('--strict-names');
});

describe.skipIf(!process.env.PG_BIN)(
  'selected backup on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    const run = (name: string, args: string[]) =>
      Bun.spawnSync([join(process.env.PG_BIN ?? '', name), ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
    const dump = () =>
      run('pg_dump', [
        '-h',
        cluster.directory,
        '-p',
        String(cluster.options.port),
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-Fc',
        '--strict-names',
        '--no-owner',
        '--no-privileges',
        ...tables.flatMap((table) => ['-t', table]),
        '-f',
        join(cluster.directory, 'selected.dump'),
      ]);

    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          tables.map(
            async (table) =>
              [
                table,
                Array.from(
                  await cluster.sql`
                SELECT to_jsonb(t)::text AS row FROM ${cluster.sql(table)} AS t
                ORDER BY to_jsonb(t)::text
              `,
                ),
              ] as const,
          ),
        ),
      );
    const roundTrip = async () => {
      const result = dump();
      expect({
        code: result.exitCode,
        stderr: result.stderr.toString(),
      }).toEqual({ code: 0, stderr: '' });
      const contents = run('pg_restore', [
        '--list',
        join(cluster.directory, 'selected.dump'),
      ]);
      expect(contents.exitCode).toBe(0);
      const entries = new Map(
        [
          ...contents.stdout
            .toString()
            .matchAll(/^(.+ TABLE DATA public (\S+) .+)$/gm),
        ].map(([, entry, name]) => [`public.${name}`, entry]),
      );
      expect([...entries.keys()].toSorted()).toEqual(tables.toSorted());
      const restoreOrder = join(cluster.directory, 'restore.list');
      writeFileSync(
        restoreOrder,
        `${tables.map((table) => entries.get(table)).join('\n')}\n`,
      );
      for (const table of tables.toReversed()) {
        await cluster.sql`DELETE FROM ${cluster.sql(table)}`;
      }
      const restored = run('pg_restore', [
        '--use-list',
        restoreOrder,
        '--data-only',
        '--exit-on-error',
        '--single-transaction',
        '-h',
        cluster.directory,
        '-p',
        String(cluster.options.port),
        '-U',
        'postgres',
        '-d',
        'postgres',
        join(cluster.directory, 'selected.dump'),
      ]);
      expect({
        code: restored.exitCode,
        stderr: restored.stderr.toString(),
      }).toEqual({ code: 0, stderr: '' });
    };

    beforeAll(() => {
      cluster = startPostgres();
    }, 30_000);
    beforeEach(async () => {
      await cluster.sql.unsafe(
        'DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
      );
      await createSchemaFixture(cluster.sql);
      await cluster.sql`INSERT INTO authors (id,name) VALUES (1,'Synthetic')`;
      await cluster.sql`INSERT INTO podcasts (id,itunes_id,author_id,title,cover,feed_url) VALUES (1,101,1,'Synthetic','','https://example.invalid/current')`;
      await cluster.sql`INSERT INTO podcast_feed_aliases (feed_url,podcast_id,evidence_type,evidence_reference) VALUES ('https://example.invalid/previous',1,'reviewed','synthetic-review')`;
      await cluster.sql`INSERT INTO podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (303,1,'reviewed','synthetic-review')`;
      await cluster.sql`INSERT INTO users (id,email) VALUES ('owner','owner@example.invalid')`;
      await cluster.sql`
        INSERT INTO episodes (id,podcast_id,guid,published) VALUES
          (101,1,'first','2026-01-01'), (102,1,'second','2026-01-02')
      `;
      await cluster.sql`INSERT INTO countries (id,name) VALUES ('aa','First'), ('bb','Second')`;
    }, 30_000);
    afterAll(async () => {
      await cluster?.stop();
    });

    test('every migrated table is selected or has an explicit exclusion', async () => {
      const excluded = {
        authors: 'Catalogue metadata; recover with parent identities',
        countries: 'Reference data; required before restoring chart history',
        episode_content: 'Refetchable content, not episode identity',
        episodes: 'Partial identity snapshot in podcst-identity-backup.sh',
        feed_poll_state: 'Rebuildable polling state',
        genres: 'Reference taxonomy seeded by migrations',
        oauth_accounts: 'Unused legacy table; current auth uses passkeys',
        podcasts: 'Partial identity snapshot in podcst-identity-backup.sh',
        podcasts_genres: 'Refetchable catalogue genre assignments',
        poll_metrics: 'Operational telemetry',
        top_podcasts: 'Refreshable current charts; history is selected',
      };
      const inventory = await cluster.sql`
        SELECT 'public.' || tablename AS name FROM pg_tables
        WHERE schemaname = 'public' ORDER BY tablename
      `;
      expect(
        [
          ...tables,
          ...Object.keys(excluded).map((name) => `public.${name}`),
        ].toSorted(),
      ).toEqual(inventory.map(({ name }) => name));
    });

    test('selected dump restores exact rows with required parent identities present', async () => {
      await cluster.sql`INSERT INTO account_preferences (user_id,speed,volume_boost,trim_silence) VALUES ('owner',1.5,true,false)`;
      await cluster.sql`INSERT INTO subscriptions (user_id,podcast_id) VALUES ('owner',1)`;
      await cluster.sql`INSERT INTO playback_progress (user_id,episode_id,position,completed) VALUES ('owner',101,123,true)`;
      await cluster.sql`INSERT INTO passkeys (id,user_id,credential_id,public_key,counter) VALUES ('passkey','owner','credential',decode('1234','hex'),7)`;
      await cluster.sql`INSERT INTO sessions (id,user_id,expires_at) VALUES ('session','owner','2030-01-01')`;
      await cluster.sql`INSERT INTO email_verifications (id,email,code_digest,expires_at) VALUES ('verification','owner@example.invalid',${'a'.repeat(64)},'2030-01-01')`;
      await cluster.sql`INSERT INTO transcripts (episode_id,content,segments,source) VALUES (101,'Synthetic','[{"start":0,"text":"Synthetic"}]','synthetic')`;
      const starred = randomUUID();
      const playlist = randomUUID();
      await cluster.sql`
        INSERT INTO episode_lists (id,user_id,kind,name,revision,created_at,updated_at) VALUES
          (${starred},'owner','starred',NULL,42,'2026-01-01 01:02:03.123456+00','2026-01-02 02:03:04.654321+00'),
          (${playlist},'owner','playlist','Listen later',9007199254740993,'2026-01-03','2026-01-04')
      `;
      await cluster.sql`
        INSERT INTO episode_list_items (list_id,episode_id,added_at) VALUES
          (${starred},101,'2026-01-02 02:03:04.123+00'),
          (${starred},102,'2026-01-02 02:03:04.123+00'),
          (${playlist},102,'2026-01-04 03:04:05.678+00')
      `;
      await cluster.sql`
        INSERT INTO episode_list_clients (user_id,client_id,last_sequence,last_request_hash,last_result) VALUES
          ('owner',${randomUUID()},9007199254740993,'synthetic-hash','{"sequence":"9007199254740993","revision":"42","results":[{"episodeId":101,"status":"applied"}]}'),
          ('owner',${randomUUID()},0,NULL,NULL)
      `;
      await cluster.sql`
        INSERT INTO chart_history (country_id,day,podcast_id,rank) VALUES
          ('aa','2026-01-01',1,3), ('aa','2026-01-02',1,1), ('bb','2026-01-01',1,8)
      `;
      const before = await snapshot();
      for (const rows of Object.values(before))
        expect(rows.length).toBeGreaterThan(0);
      await roundTrip();
      expect(await snapshot()).toEqual(before);
      expect(await cluster.sql`SELECT * FROM episode_content`).toHaveLength(0);
      expect(await cluster.sql`SELECT * FROM top_podcasts`).toHaveLength(0);
    });

    test('restored client state deduplicates a lost-response retry after a removal', async () => {
      const service = createEpisodeListService(cluster.sql);
      const listId = (await service.lists('owner')).lists[0].id;
      const request: ListBatch = {
        clientId: randomUUID(),
        sequence: '1',
        changes: [{ op: 'add', episodeId: 101 }],
      };
      const acknowledgement = await service.change('owner', listId, request);
      await service.change('owner', listId, {
        clientId: randomUUID(),
        sequence: '1',
        changes: [{ op: 'remove', episodeId: 101 }],
      });
      const before = await snapshot();
      await roundTrip();
      expect(await service.change('owner', listId, request)).toEqual(
        acknowledgement,
      );
      expect(await service.membership('owner', listId)).toEqual({
        listId,
        revision: '2',
        items: [],
      });
      expect(await snapshot()).toEqual(before);
    });

    test('temporary tables cannot shadow either alias guard', async () => {
      await cluster.sql`INSERT INTO podcasts (id,author_id,title,cover,feed_url,owner_user_id) VALUES (2,1,'Private','','https://example.invalid/private','owner')`;
      await cluster.sql.begin(async (tx) => {
        await tx.unsafe(`
          CREATE TEMP TABLE podcasts (id bigint, owner_user_id text) ON COMMIT DROP;
          INSERT INTO pg_temp.podcasts VALUES (2,NULL);
          CREATE TEMP TABLE podcast_feed_aliases (feed_url text, podcast_id bigint) ON COMMIT DROP;
        `);
        await expect(
          tx.savepoint(async (sp) => {
            await sp`INSERT INTO public.podcast_feed_aliases (feed_url,podcast_id,evidence_type,evidence_reference) VALUES ('https://example.invalid/private-alias',2,'reviewed','synthetic-review')`;
          }),
        ).rejects.toThrow('Alias target must be public');
        await expect(
          tx.savepoint(async (sp) => {
            await sp`INSERT INTO public.podcasts (id,author_id,title,cover,feed_url) VALUES (3,1,'Collision','','https://example.invalid/previous')`;
          }),
        ).rejects.toThrow('Locator is an accepted alias');
      });
    });

    test.each(
      tables,
    )('missing %s refuses an incomplete dump', async (table) => {
      await cluster.sql`DROP TABLE ${cluster.sql(table)} CASCADE`;
      expect(dump().exitCode).not.toBe(0);
    });
  },
);
