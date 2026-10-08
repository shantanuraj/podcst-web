import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { createEpisodeListService } from '@/server/lists/service';
import { createFollowStateService } from '@/server/state/follows';
import { createProgressStateService } from '@/server/state/progress';
import type { ListBatch } from '@/shared/lists';
import { startPostgres } from './lib/postgres-sandbox';
import { loadMigrations, migrate, migrationStatus } from './migrations';

const script = readFileSync(
  new URL('./podcst-backup.sh', import.meta.url),
  'utf8',
);
const tables = [...script.matchAll(/-t ([a-z_]+\.[a-z_]+)/g)].map(
  (match) => match[1],
);
const excluded = {
  feed_poll_state:
    'Rebuildable validators and scheduling; cold polling costs I/O',
  poll_metrics:
    'Operational telemetry, not listener state or recovery evidence',
  top_podcasts: 'Refreshable current charts; historical ranks remain selected',
};
const privatePodcast = '9007199254740993';
const privateEpisode = '9007199254740995';

test('selected backup includes coherent parents, content and the migration ledger', () => {
  expect(new Set(tables).size).toBe(tables.length);
  for (const table of [
    'podcst_migrations.history',
    'public.authors',
    'public.countries',
    'public.genres',
    'public.podcasts',
    'public.episodes',
    'public.episode_content',
    'public.podcasts_genres',
    'public.oauth_accounts',
    'public.episode_lists',
    'public.episode_list_items',
    'public.episode_list_clients',
    'public.chart_history',
    'public.state_generation',
    'public.progress_clients',
    'public.follow_clients',
  ]) {
    expect(tables).toContain(table);
  }
  expect(script).toContain('--strict-names');
});

describe.skipIf(!process.env.PG_BIN)(
  'coherent backup on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let target: postgres.Sql | undefined;
    const run = (name: string, args: string[]) =>
      Bun.spawnSync([join(process.env.PG_BIN ?? '', name), ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
    const connection = (database = 'postgres') => [
      '-h',
      cluster.directory,
      '-p',
      String(cluster.options.port),
      '-U',
      'postgres',
      '-d',
      database,
    ];
    const archive = (full = false) =>
      join(cluster.directory, full ? 'full.dump' : 'selected.dump');
    const dump = (full = false) =>
      run('pg_dump', [
        ...connection(),
        '-Fc',
        '--strict-names',
        '--no-owner',
        '--no-privileges',
        ...(full ? [] : tables.flatMap((table) => ['-t', table])),
        '-f',
        archive(full),
      ]);
    const success = (result: ReturnType<typeof run>) => {
      expect({
        code: result.exitCode,
        stderr: result.stderr.toString(),
      }).toEqual({ code: 0, stderr: '' });
    };
    const snapshot = async (sql: postgres.Sql) =>
      Object.fromEntries(
        await Promise.all(
          tables.map(
            async (table) =>
              [
                table,
                Array.from(
                  await sql`
              SELECT to_jsonb(t)::text AS row FROM ${sql(table)} AS t
              ORDER BY to_jsonb(t)::text
            `,
                ),
              ] as const,
          ),
        ),
      );
    const sequences = async (sql: postgres.Sql) => {
      const owned = await sql`
        SELECT ns.nspname || '.' || seq.relname AS name
        FROM pg_class seq
        JOIN pg_namespace ns ON ns.oid = seq.relnamespace
        JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
        JOIN pg_class parent ON parent.oid = dep.refobjid
        JOIN pg_namespace pn ON pn.oid = parent.relnamespace
        WHERE seq.relkind = 'S'
          AND pn.nspname || '.' || parent.relname = ANY(${tables}::text[])
        ORDER BY name
      `;
      return Object.fromEntries(
        await Promise.all(
          owned.map(async ({ name }) => [
            name,
            Array.from(
              await sql`
              SELECT last_value::text, is_called FROM ${sql(name)}
            `,
            ),
          ]),
        ),
      );
    };
    const restore = async (capture = true) => {
      if (capture) success(dump());
      const contents = run('pg_restore', ['--list', archive()]);
      success(contents);
      const entries = new Map(
        [
          ...contents.stdout
            .toString()
            .matchAll(/^(.+ TABLE DATA (\S+) (\S+) .+)$/gm),
        ].map(([, entry, schema, name]) => [`${schema}.${name}`, entry]),
      );
      expect([...entries.keys()].toSorted()).toEqual(tables.toSorted());
      const sequenceEntries = [
        ...contents.stdout
          .toString()
          .matchAll(/^(.+ SEQUENCE SET (\S+) (\S+) .+)$/gm),
      ];
      expect(
        sequenceEntries.map(([, , schema, name]) => `${schema}.${name}`).sort(),
      ).toEqual(Object.keys(await sequences(cluster.sql)).sort());
      const restoreOrder = join(cluster.directory, 'restore.list');
      writeFileSync(
        restoreOrder,
        `${[
          ...tables.map((table) => entries.get(table)),
          ...sequenceEntries.map(([entry]) => entry),
        ].join('\n')}\n`,
        { mode: 0o600 },
      );
      await cluster.sql`CREATE DATABASE restored TEMPLATE template0`;
      target = postgres({ ...cluster.options, database: 'restored' });
      await migrate(target);
      await target`DELETE FROM podcst_migrations.history`;
      await target`DELETE FROM genres`;
      await target`DELETE FROM state_generation`;
      for (const table of tables) {
        expect(
          (await target`SELECT count(*)::int AS count FROM ${target(table)}`)[0]
            .count,
        ).toBe(0);
      }
      success(
        run('pg_restore', [
          '--use-list',
          restoreOrder,
          '--data-only',
          '--exit-on-error',
          '--single-transaction',
          ...connection('restored'),
          archive(),
        ]),
      );
      const status = await migrationStatus(target);
      expect(status.state).toBe('tracked');
      expect(status.migrations.every(({ state }) => state === 'applied')).toBe(
        true,
      );
      expect(
        await target`SELECT 1 FROM pg_constraint WHERE NOT convalidated`,
      ).toHaveLength(0);
      expect(
        await target`SELECT 1 FROM pg_trigger WHERE tgenabled != 'O'`,
      ).toHaveLength(0);
      return target;
    };
    const stream = async (accountId = 'owner') => ({
      protocol: 1 as const,
      accountId,
      generation: (
        await cluster.sql`SELECT generation FROM state_generation`
      )[0].generation as string,
      clientId: randomUUID(),
      sequence: '1',
    });

    beforeAll(() => {
      cluster = startPostgres();
    }, 30_000);
    beforeEach(async () => {
      const sql = cluster.sql;
      await sql.unsafe(
        'DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS podcst_migrations CASCADE; CREATE SCHEMA public;',
      );
      await migrate(sql);
      await sql`INSERT INTO users (id,email) VALUES ('owner','owner@example.invalid'), ('other','other@example.invalid')`;
      await sql`INSERT INTO authors (id,name) VALUES (1,'Synthetic')`;
      await sql`
        INSERT INTO podcasts (id,itunes_id,author_id,title,cover,feed_url,owner_user_id,primary_genre_id) VALUES
          (1,101,1,'Unavailable publisher','','https://gone.invalid/public',NULL,26),
          (${privatePodcast},NULL,1,'Private archive','','https://gone.invalid/private?token=synthetic','owner',26)
      `;
      await sql`INSERT INTO podcast_feed_aliases (feed_url,podcast_id,evidence_type,evidence_reference) VALUES ('https://example.invalid/previous',1,'reviewed','synthetic-review')`;
      await sql`INSERT INTO podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (303,1,'reviewed','synthetic-review')`;
      await sql`
        INSERT INTO episodes (id,podcast_id,guid,published) VALUES
          (101,1,'first','2026-01-01'), (102,1,'second','2026-01-02'),
          (${privateEpisode},${privatePodcast},'private','2026-01-03')
      `;
      await sql`
        INSERT INTO episode_content (episode_id,title,summary,duration,file_url,file_length,file_type) VALUES
          (101,'Saved public title','Saved show notes',900,'https://gone.invalid/public.mp3',12345,'audio/mpeg'),
          (${privateEpisode},'Saved private title','Private notes',600,'https://gone.invalid/private.mp3?token=synthetic',23456,'audio/mpeg')
      `;
      await sql`INSERT INTO countries (id,name) VALUES ('aa','First'), ('bb','Second')`;
      await sql`INSERT INTO podcasts_genres (podcast_id,genre_id) VALUES (1,26), (${privatePodcast},26)`;
      await sql`SELECT setval('authors_id_seq',700000000)`;
      await sql`SELECT setval('podcasts_id_seq',9007199254741993)`;
      await sql`SELECT setval('episodes_id_seq',9007199254742995,false)`;
    }, 30_000);
    afterEach(async () => {
      await target?.end({ timeout: 5 });
      target = undefined;
      await cluster.sql`DROP DATABASE IF EXISTS restored`;
    });
    afterAll(async () => {
      await cluster?.stop();
    });

    test('every migrated table is selected or explicitly rebuildable', async () => {
      const inventory = await cluster.sql`
        SELECT schemaname || '.' || tablename AS name FROM pg_tables
        WHERE schemaname IN ('public', 'podcst_migrations') ORDER BY name
      `;
      expect(
        [
          ...tables,
          ...Object.keys(excluded).map((name) => `public.${name}`),
        ].toSorted(),
      ).toEqual(inventory.map(({ name }) => name));
      const dependencies = await cluster.sql`
        SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
        FROM pg_constraint WHERE contype = 'f' AND conrelid != confrelid
      `;
      for (const { child, parent } of dependencies) {
        if (!tables.includes(`public.${child}`)) continue;
        expect(tables).toContain(`public.${parent}`);
        expect(tables.indexOf(`public.${parent}`)).toBeLessThan(
          tables.indexOf(`public.${child}`),
        );
      }
    });

    test('fresh constrained restore preserves exact rows, ledger, ownership and sequence positions', async () => {
      const sql = cluster.sql;
      await sql`INSERT INTO account_preferences (user_id,speed,volume_boost,trim_silence) VALUES ('owner',1.5,true,false)`;
      await sql`INSERT INTO oauth_accounts (provider,provider_account_id,user_id,access_token) VALUES ('synthetic','legacy','owner','synthetic-token')`;
      await createFollowStateService(sql).change('owner', {
        ...(await stream()),
        changes: [{ podcastId: privatePodcast, followed: true }],
      });
      await createProgressStateService(sql).change('owner', {
        ...(await stream()),
        changes: [
          { episodeId: privateEpisode, positionSeconds: 123, completed: true },
        ],
      });
      await sql`INSERT INTO passkeys (id,user_id,credential_id,public_key,counter) VALUES ('passkey','owner','credential',decode('1234','hex'),7)`;
      await sql`INSERT INTO sessions (id,user_id,expires_at) VALUES ('session','owner','2030-01-01')`;
      await sql`INSERT INTO email_verifications (id,email,code_digest,expires_at) VALUES ('verification','owner@example.invalid',${'a'.repeat(64)},'2030-01-01')`;
      await sql`INSERT INTO transcripts (episode_id,content,segments,source) VALUES (101,'Synthetic','[{"start":0,"text":"Synthetic"}]','synthetic')`;
      const lists = createEpisodeListService(sql);
      const starred = (await lists.lists('owner')).lists[0].id;
      await lists.change('owner', starred, {
        ...(await stream()),
        changes: [
          { op: 'add', episodeId: '101' },
          { op: 'add', episodeId: privateEpisode },
        ],
      });
      const playlist = randomUUID();
      await sql`
        INSERT INTO episode_lists (id,user_id,kind,name,revision,created_at,updated_at) VALUES
          (${playlist},'owner','playlist','Listen later',9007199254740993,'2026-01-03','2026-01-04')
      `;
      await sql`INSERT INTO episode_list_items (list_id,episode_id,added_at) VALUES (${playlist},102,'2026-01-04 03:04:05.678+00')`;
      await sql`
        INSERT INTO episode_list_clients (user_id,client_id,last_sequence,last_request_hash,last_result) VALUES
          ('owner',${randomUUID()},9007199254740993,'synthetic-hash','{"sequence":"9007199254740993","revision":"42","results":[]}'),
          ('owner',${randomUUID()},0,NULL,NULL)
      `;
      await sql`
        INSERT INTO chart_history (country_id,day,podcast_id,rank) VALUES
          ('aa','2026-01-01',1,3), ('aa','2026-01-02',1,1), ('bb','2026-01-01',1,8)
      `;
      const before = await snapshot(sql);
      const beforeSequences = await sequences(sql);
      for (const rows of Object.values(before))
        expect(rows.length).toBeGreaterThan(0);
      const restored = await restore();
      expect(await snapshot(restored)).toEqual(before);
      expect(await sequences(restored)).toEqual(beforeSequences);
      for (const table of Object.keys(excluded))
        expect(await restored`SELECT * FROM ${restored(table)}`).toHaveLength(
          0,
        );
      const restoredLists = createEpisodeListService(restored);
      const page = await restoredLists.episodes('owner', starred, {
        limit: 10,
      });
      expect(page.items.map(({ episode }) => episode?.title).sort()).toEqual([
        'Saved private title',
        'Saved public title',
      ]);
      await expect(
        restoredLists.episodes('other', starred, { limit: 10 }),
      ).rejects.toMatchObject({ status: 404 });
      const otherList = (await restoredLists.lists('other')).lists[0].id;
      const refused = await restoredLists.change('other', otherList, {
        ...(await stream('other')),
        changes: [{ op: 'add', episodeId: privateEpisode }],
      });
      expect(refused.results[0].status).toBe('not_found');
      const [author] =
        await restored`INSERT INTO authors (name) VALUES ('New author') RETURNING id::text`;
      expect(author.id).toBe('700000001');
      const [podcast] =
        await restored`INSERT INTO podcasts (author_id,title,cover,feed_url) VALUES (${author.id},'New show','','https://new.invalid/feed') RETURNING id::text`;
      expect(podcast.id).toBe('9007199254741994');
      const [episode] =
        await restored`INSERT INTO episodes (podcast_id,guid,published) VALUES (${podcast.id},'new','2026-02-01') RETURNING id::text`;
      expect(episode.id).toBe('9007199254742995');
      await expect(
        restored`INSERT INTO episode_content (episode_id,title,file_url) VALUES (999,'Orphan','https://gone.invalid/orphan')`.execute(),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        restored`INSERT INTO podcast_feed_aliases (feed_url,podcast_id,evidence_type,evidence_reference) VALUES ('https://gone.invalid/leak',${privatePodcast},'reviewed','synthetic')`.execute(),
      ).rejects.toThrow('Alias target must be public');
    });

    test('restored list acknowledgements cannot undo a later removal', async () => {
      const service = createEpisodeListService(cluster.sql);
      const listId = (await service.lists('owner')).lists[0].id;
      const request: ListBatch = {
        ...(await stream()),
        changes: [{ op: 'add', episodeId: '101' }],
      };
      const acknowledgement = await service.change('owner', listId, request);
      await service.change('owner', listId, {
        ...(await stream()),
        changes: [{ op: 'remove', episodeId: '101' }],
      });
      const before = await snapshot(cluster.sql);
      const restored = await restore();
      const recovered = createEpisodeListService(restored);
      expect(await recovered.change('owner', listId, request)).toEqual(
        acknowledgement,
      );
      expect((await recovered.membership('owner', listId)).items).toEqual([]);
      expect(await snapshot(restored)).toEqual(before);
      await recovered.change('owner', listId, { ...request, sequence: '2' });
      expect((await recovered.membership('owner', listId)).items).toHaveLength(
        1,
      );
    });

    test('restored progress and follow retries preserve later intent and accept subsequent mutations', async () => {
      const progress = createProgressStateService(cluster.sql);
      const follows = createFollowStateService(cluster.sql);
      const scope = await stream();
      const progressBatch = {
        ...scope,
        changes: [{ episodeId: '101', positionSeconds: 90, completed: false }],
      };
      const followBatch = {
        ...scope,
        changes: [{ podcastId: '1', followed: true }],
      };
      const progressAck = await progress.change('owner', progressBatch);
      const followAck = await follows.change('owner', followBatch);
      await progress.change('owner', {
        ...(await stream()),
        changes: [{ episodeId: '101', positionSeconds: 12, completed: false }],
      });
      await follows.change('owner', {
        ...(await stream()),
        changes: [{ podcastId: '1', followed: false }],
      });
      const before = await snapshot(cluster.sql);
      const restored = await restore();
      const restoredProgress = createProgressStateService(restored);
      const restoredFollows = createFollowStateService(restored);
      expect(await restoredProgress.change('owner', progressBatch)).toEqual(
        progressAck,
      );
      expect(await restoredFollows.change('owner', followBatch)).toEqual(
        followAck,
      );
      expect(
        (await restoredProgress.read('owner', ['101'])).items[0].progress
          ?.positionSeconds,
      ).toBe(12);
      expect((await restoredFollows.read('owner')).items).toEqual([]);
      expect(await snapshot(restored)).toEqual(before);
      expect(
        (
          await restoredProgress.change('owner', {
            ...progressBatch,
            sequence: '2',
          })
        ).revision,
      ).toBe('3');
      expect(
        (
          await restoredFollows.change('owner', {
            ...followBatch,
            sequence: '2',
          })
        ).revision,
      ).toBe('3');
    });

    test('generation rotation fences accepted and pending post-checkpoint work across all resources', async () => {
      const progress = createProgressStateService(cluster.sql);
      const follows = createFollowStateService(cluster.sql);
      const lists = createEpisodeListService(cluster.sql);
      const listId = (await lists.lists('owner')).lists[0].id;
      const scope = await stream();
      const progressBatch = {
        ...scope,
        changes: [{ episodeId: '101', positionSeconds: 30, completed: false }],
      };
      const followBatch = {
        ...scope,
        changes: [{ podcastId: '1', followed: true }],
      };
      const listBatch: ListBatch = {
        ...scope,
        changes: [{ op: 'add', episodeId: '101' }],
      };
      await progress.change('owner', progressBatch);
      await follows.change('owner', followBatch);
      await lists.change('owner', listId, listBatch);
      success(dump());
      const laterProgress = {
        ...progressBatch,
        sequence: '2',
        changes: [{ episodeId: '101', positionSeconds: 60, completed: false }],
      };
      await progress.change('owner', laterProgress);
      await follows.change('owner', {
        ...followBatch,
        sequence: '2',
        changes: [{ podcastId: '1', followed: false }],
      });
      await lists.change('owner', listId, {
        ...listBatch,
        sequence: '2',
        changes: [{ op: 'remove', episodeId: '101' }],
      });
      const restored = await restore(false);
      await restored`UPDATE state_generation SET generation = ${randomUUID()}`;
      const before = await snapshot(restored);
      for (const sequence of ['1', '2', '3']) {
        await expect(
          createProgressStateService(restored).change('owner', {
            ...laterProgress,
            sequence,
          }),
        ).rejects.toMatchObject({ code: 'recovery_required' });
        await expect(
          createFollowStateService(restored).change('owner', {
            ...followBatch,
            sequence,
          }),
        ).rejects.toMatchObject({ code: 'recovery_required' });
        await expect(
          createEpisodeListService(restored).change('owner', listId, {
            ...listBatch,
            sequence,
          }),
        ).rejects.toMatchObject({ code: 'recovery_required' });
      }
      const current = (await restored`SELECT * FROM state_generation`)[0];
      await expect(
        createEpisodeListService(restored).migrate(
          'owner',
          listId,
          { ...scope, generation: current.generation },
          {
            clientId: randomUUID(),
            sequence: '1',
            changes: [{ op: 'add', episodeId: 101 }],
          },
        ),
      ).rejects.toMatchObject({ code: 'recovery_required' });
      expect(current.legacy_generation).toBe(scope.generation);
      expect(await snapshot(restored)).toEqual(before);
    });

    test('pre-checkpoint cascades stay deleted without disturbing public parents or other accounts', async () => {
      const sql = cluster.sql;
      const lists = createEpisodeListService(sql);
      const listId = (await lists.lists('owner')).lists[0].id;
      await lists.change('owner', listId, {
        ...(await stream()),
        changes: [{ op: 'add', episodeId: privateEpisode }],
      });
      await createFollowStateService(sql).change('owner', {
        ...(await stream()),
        changes: [{ podcastId: privatePodcast, followed: true }],
      });
      await createProgressStateService(sql).change('owner', {
        ...(await stream()),
        changes: [
          { episodeId: privateEpisode, positionSeconds: 10, completed: false },
        ],
      });
      await sql`INSERT INTO sessions (id,user_id,expires_at) VALUES ('session','owner','2030-01-01')`;
      await sql`INSERT INTO passkeys (id,user_id,credential_id,public_key) VALUES ('passkey','owner','credential',decode('1234','hex'))`;
      await sql.begin(async (tx) => {
        await tx`DELETE FROM users WHERE id = 'owner'`;
      });
      const before = await snapshot(sql);
      const restored = await restore();
      expect(await snapshot(restored)).toEqual(before);
      expect(Array.from(await restored`SELECT id FROM users`)).toEqual([
        { id: 'other' },
      ]);
      expect(Array.from(await restored`SELECT id::text FROM podcasts`)).toEqual(
        [{ id: '1' }],
      );
      expect(await restored`SELECT * FROM sessions`).toHaveLength(0);
      expect(await restored`SELECT * FROM passkeys`).toHaveLength(0);
      expect(await restored`SELECT * FROM episode_list_clients`).toHaveLength(
        0,
      );
    });

    test('generation fencing alone cannot suppress post-checkpoint deletions or credentials', async () => {
      await cluster.sql`INSERT INTO sessions (id,user_id,expires_at) VALUES ('revoked-later','owner','2030-01-01')`;
      await cluster.sql`INSERT INTO passkeys (id,user_id,credential_id,public_key) VALUES ('removed-later','owner','credential',decode('1234','hex'))`;
      success(dump());
      await cluster.sql`DELETE FROM users WHERE id = 'owner'`;
      const restored = await restore(false);
      await restored`UPDATE state_generation SET generation = ${randomUUID()}`;
      expect(
        await restored`SELECT id FROM users WHERE id = 'owner'`,
      ).toHaveLength(1);
      expect(
        await restored`SELECT id FROM sessions WHERE id = 'revoked-later'`,
      ).toHaveLength(1);
      expect(
        await restored`SELECT id FROM passkeys WHERE id = 'removed-later'`,
      ).toHaveLength(1);
    });

    test('retains alias guards against temporary-table shadowing after recovery', async () => {
      const restored = await restore();
      await restored.begin(async (tx) => {
        await tx.unsafe(`
          CREATE TEMP TABLE podcasts (id bigint, owner_user_id text) ON COMMIT DROP;
          INSERT INTO pg_temp.podcasts VALUES (${privatePodcast},NULL);
          CREATE TEMP TABLE podcast_feed_aliases (feed_url text, podcast_id bigint) ON COMMIT DROP;
        `);
        await expect(
          tx.savepoint(async (sp) => {
            await sp`INSERT INTO public.podcast_feed_aliases (feed_url,podcast_id,evidence_type,evidence_reference) VALUES ('https://example.invalid/private-alias',${privatePodcast},'reviewed','synthetic-review')`;
          }),
        ).rejects.toThrow('Alias target must be public');
        await expect(
          tx.savepoint(async (sp) => {
            await sp`INSERT INTO public.podcast_apple_aliases (itunes_id,podcast_id,evidence_type,evidence_reference) VALUES (404,${privatePodcast},'reviewed','synthetic-review')`;
          }),
        ).rejects.toThrow('Apple alias target must be public');
        await expect(
          tx.savepoint(async (sp) => {
            await sp`INSERT INTO public.podcasts (id,author_id,title,cover,feed_url) VALUES (3,1,'Collision','','https://example.invalid/previous')`;
          }),
        ).rejects.toThrow('Locator is an accepted alias');
      });
    });

    test('records synthetic selected versus full dump size and elapsed time', async () => {
      await cluster.sql`
        INSERT INTO episodes (id,podcast_id,guid,published)
        SELECT 1000 + n,1,'volume-' || n,'2026-01-01'::timestamptz
        FROM generate_series(1,2000) n
      `;
      await cluster.sql`
        INSERT INTO episode_content (episode_id,title,summary,file_url)
        SELECT 1000 + n,'Episode ' || n,
          (SELECT string_agg(md5(n::text || '-' || part::text),'') FROM generate_series(1,32) part),
          'https://gone.invalid/' || n || '.mp3'
        FROM generate_series(1,2000) n
      `;
      await cluster.sql`
        INSERT INTO poll_metrics (metric_name,metric_value)
        SELECT md5(n::text),n FROM generate_series(1,10000) n
      `;
      const results = [];
      for (const full of [false, true]) {
        const started = performance.now();
        success(dump(full));
        results.push({
          kind: full ? 'full' : 'selected',
          bytes: statSync(archive(full)).size,
          dumpMs: Math.round(performance.now() - started),
        });
      }
      const started = performance.now();
      const restored = await restore(false);
      const restoreMs = Math.round(performance.now() - started);
      expect(await snapshot(restored)).toEqual(await snapshot(cluster.sql));
      expect(results[0].bytes).toBeLessThan(results[1].bytes);
      console.info(
        JSON.stringify({ syntheticBackupComparison: results, restoreMs }),
      );
    }, 30_000);

    test('restored migration checksums must match the source chain', async () => {
      await cluster.sql`UPDATE podcst_migrations.history SET checksum = ${'a'.repeat(64)} WHERE name = ${loadMigrations()[0].name}`;
      await expect(restore()).rejects.toThrow(
        'Applied migration checksum changed',
      );
    });

    test.each(
      tables,
    )('missing %s refuses an incomplete dump', async (table) => {
      await cluster.sql`DROP TABLE ${cluster.sql(table)} CASCADE`;
      expect(dump().exitCode).not.toBe(0);
    });
  },
);
