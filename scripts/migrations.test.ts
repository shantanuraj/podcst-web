import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { startPostgres } from './lib/postgres-sandbox';
import { createSchemaFixture } from './lib/schema-fixture';
import { seedFollow, seedProgress } from './lib/state-fixture';
import {
  migrate as applyMigrations,
  migrationStatus as inspectMigrations,
  loadMigrations,
  lockMigrations,
} from './migrations';

const baseline = loadMigrations()[0];
const onlineIndex = `-- podcst-migration: concurrent-index
CREATE INDEX CONCURRENTLY idx_episodes_podcast_published ON public.episodes (podcast_id, published DESC);`;
const onlineChain = () => files({ '0001-online-index.sql': onlineIndex });

function files(extra: Record<string, string> = {}, initial = baseline.source) {
  const directory = mkdtempSync(join(tmpdir(), 'podcst-migrations-'));
  try {
    for (const [name, source] of Object.entries({
      '0000-baseline.sql': initial,
      ...extra,
    })) {
      writeFileSync(join(directory, name), source);
    }
    return loadMigrations(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function migrate(sql: postgres.Sql, migrations = files()) {
  return applyMigrations(sql, migrations);
}

function migrationStatus(sql: postgres.Sql, migrations = files()) {
  return inspectMigrations(sql, migrations);
}

function cli(
  args: readonly string[],
  url = '',
  cwd?: string,
  onlineTimeout?: string,
) {
  return Bun.spawnSync(
    [process.execPath, resolve('scripts/migrate.ts'), ...args],
    {
      cwd,
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: url,
        DATABASE_URL: 'postgres://must-not-be-used.invalid/app',
        MIGRATION_ONLINE_TIMEOUT_MS: onlineTimeout,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
}

describe('migration files and CLI safety', () => {
  test('loads the active chain, never historical repair SQL', () => {
    const names = loadMigrations().map(({ name }) => name);
    expect(names[0]).toBe('0000-baseline.sql');
    expect(names).not.toContain('0004-episodes-bigint.sql');
    expect(baseline.checksum).toBe(
      createHash('sha256').update(baseline.source).digest('hex'),
    );
  });

  test('retains the applied erasure schema without activating recovery admission', () => {
    const migrations = loadMigrations();
    expect(
      migrations.find(({ name }) => name === '0013-account-erasure.sql')
        ?.checksum,
    ).toBe('0a0d3cd65e6369267f16085f37c1389029fae10db99abce8933c6445c03a2733');
    expect(migrations.map(({ name }) => name)).not.toContain(
      '0014-recovery-admission.sql',
    );
  });

  test('checksums include exact source bytes and pending files sort by version', () => {
    const migrations = files({
      '0002-second.sql': 'SELECT 2;',
      '0001-first.sql': 'SELECT 1;',
    });
    expect(migrations.map(({ name }) => name)).toEqual([
      '0000-baseline.sql',
      '0001-first.sql',
      '0002-second.sql',
    ]);
    expect(files({}, `${baseline.source}\n`)[0].checksum).not.toBe(
      baseline.checksum,
    );
  });

  test.each([
    '0000-other.sql',
    '0001_bad.sql',
    '1-short.sql',
  ])('rejects invalid or duplicate versions: %s', (name) => {
    expect(() => files({ [name]: 'SELECT 1;' })).toThrow(
      'Invalid or duplicate',
    );
  });

  test('rejects empty migrations', () => {
    expect(() => files({ '0001-empty.sql': '  ;  ' })).toThrow(
      'Empty migration',
    );
  });

  test.each([
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS ix ON public.episodes (id);',
    'CREATE UNIQUE INDEX CONCURRENTLY ix ON public.episodes (id);',
    'CREATE INDEX CONCURRENTLY ix ON public.episodes ((id + 1));',
    'CREATE INDEX CONCURRENTLY ix ON public.episodes (id) INCLUDE (guid);',
    'CREATE INDEX CONCURRENTLY ix ON public.episodes (id) WHERE id > 0;',
    'CREATE INDEX CONCURRENTLY ix ON public.episodes (id); SELECT 1;',
    'CREATE INDEX ix ON public.episodes (id);',
    'DROP INDEX CONCURRENTLY public.ix;',
    'CREATE INDEX CONCURRENTLY ix ON episodes (id);',
  ])('rejects unsupported marked online SQL: %s', (source) => {
    expect(() =>
      files({
        '0001-online.sql': `-- podcst-migration: concurrent-index\n${source}`,
      }),
    ).toThrow('one simple CREATE INDEX CONCURRENTLY');
  });

  test.each([
    'BEGIN',
    'COMMIT',
    'ROLLBACK',
    'END',
    'ABORT',
    'START TRANSACTION',
    'PREPARE TRANSACTION',
    'SAVEPOINT point',
    'RELEASE SAVEPOINT point',
    'SET TRANSACTION READ WRITE',
  ])('rejects migration-managed transactions: %s', (command) => {
    expect(() =>
      files({ '0001-unsafe.sql': `SELECT 1; /* boundary */ ${command};` }),
    ).toThrow('must not control its transaction');
  });

  test('ignores transaction words in strings, identifiers, comments and bodies', () => {
    expect(
      files({
        '0001-safe.sql': `
      -- COMMIT;
      /* outer /* ROLLBACK; */ BEGIN; */
      SELECT 'COMMIT; it''s text', E'quote\\'; ROLLBACK;', "COMMIT;";
      DO $body$ BEGIN PERFORM 1; END; $body$;
    `,
      }),
    ).toHaveLength(2);
  });

  test.each([
    "SELECT 'unfinished",
    '/* unfinished',
    'DO $tag$ unfinished',
  ])('rejects unterminated SQL: %s', (source) => {
    expect(() => files({ '0001-broken.sql': source })).toThrow('Unterminated');
  });

  test('requires an explicit migration target, ignoring app configuration', () => {
    const result = cli([]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('MIGRATION_DATABASE_URL');
    expect(result.stderr.toString()).not.toContain('must-not-be-used');
  });

  test.each([
    'postgres://localhost/',
    'postgres:///database',
    'https://localhost/database',
    'not a URL',
  ])('rejects an incomplete or invalid database target: %s', (url) => {
    const result = cli([], url);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('MIGRATION_DATABASE_URL');
  });

  test.each([
    { args: ['0004-episodes-bigint.sql'] },
    { args: ['up', '--force'] },
    { args: ['baseline'] },
  ])('rejects unsupported invocation %j', ({ args }) => {
    expect(cli(args).stderr.toString()).toContain('Usage:');
  });
});

const seed = `
INSERT INTO authors (id, name) VALUES (1, 'Synthetic author');
INSERT INTO podcasts (id, author_id, feed_url, title, cover) VALUES (1, 1, 'https://example.invalid/rss', 'Show', 'cover');
INSERT INTO episodes (id, podcast_id, guid, published) VALUES (10, 1, 'episode', '2026-01-01');
INSERT INTO episode_content (episode_id, title, file_url) VALUES (10, 'Episode', 'https://example.invalid/audio.mp3');
INSERT INTO users (id, email) VALUES ('listener', 'listener@example.invalid');
INSERT INTO subscriptions (user_id, podcast_id) VALUES ('listener', 1);
INSERT INTO playback_progress (user_id, episode_id, position, completed) VALUES ('listener', 10, 123, false);
`;

describe.skipIf(!process.env.PG_BIN)(
  'audited migrations on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;

    beforeAll(() => {
      cluster = startPostgres();
      sql = cluster.sql;
    }, 30_000);

    afterAll(async () => {
      await cluster?.stop();
    });

    beforeEach(async () => {
      await sql.unsafe(
        'DROP SCHEMA IF EXISTS podcst_migrations CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
      );
    });

    test('status is read-only and defaults to inspection even outside the repo', async () => {
      const result = cli([], cluster.url, tmpdir());
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString()).state).toBe('empty');
      expect(
        (await sql`SELECT to_regnamespace('podcst_migrations') AS ledger`)[0]
          .ledger,
      ).toBeNull();
      const reader = postgres({
        ...cluster.options,
        connection: { default_transaction_read_only: true },
      });
      try {
        expect((await migrationStatus(reader)).state).toBe('empty');
      } finally {
        await reader.end();
      }
    });

    test('fresh CLI install creates the current split schema and ledger', async () => {
      const result = cli(['up'], cluster.url);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toEqual({
        applied: loadMigrations().map(({ name }) => name),
      });
      const status = await migrationStatus(sql, loadMigrations());
      expect(status.state).toBe('tracked');
      expect(status.migrations).toEqual(
        loadMigrations().map(({ name, checksum }) => ({
          name,
          checksum,
          state: 'applied',
        })),
      );
      const columns =
        await sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'episodes'`;
      expect(columns.map((row) => row.column_name).sort()).toEqual([
        'created_at',
        'guid',
        'id',
        'podcast_id',
        'published',
      ]);
      await sql.unsafe(
        seed.replace(
          /^INSERT INTO (?:subscriptions|playback_progress).*;$/gm,
          '',
        ),
      );
      await seedFollow(sql, 'listener', '1');
      await seedProgress(sql, 'listener', '10', 123);
      expect(
        (await sql`SELECT file_url FROM episode_content`)[0].file_url,
      ).toBe('https://example.invalid/audio.mp3');
    });

    test('repeat runs are no-ops and upgrades preserve existing references and progress', async () => {
      await migrate(sql);
      await sql.unsafe(seed);
      const before = await sql`SELECT * FROM playback_progress`;
      expect(await migrate(sql)).toEqual([]);
      const chain = files({
        '0001-timezone.sql':
          "ALTER TABLE users ADD COLUMN timezone text; UPDATE users SET timezone = 'UTC';",
      });
      expect(await migrate(sql, chain)).toEqual(['0001-timezone.sql']);
      expect(Array.from(await sql`SELECT * FROM playback_progress`)).toEqual(
        Array.from(before),
      );
      expect((await sql`SELECT timezone FROM users`)[0].timezone).toBe('UTC');
      expect(
        (await sql`SELECT episode_id::text FROM episode_content`)[0].episode_id,
      ).toBe('10');
      expect(await migrate(sql, chain)).toEqual([]);
    });

    test('a legacy split schema is refused without changing user data or recording a baseline', async () => {
      await sql.unsafe(baseline.source);
      await sql.unsafe(seed);
      const before = Array.from(await sql`SELECT * FROM playback_progress`);
      expect((await migrationStatus(sql)).state).toBe('untracked');
      await expect(migrate(sql)).rejects.toThrow(
        'no reviewed migration baseline',
      );
      expect(Array.from(await sql`SELECT * FROM playback_progress`)).toEqual(
        before,
      );
      expect(
        (await sql`SELECT to_regnamespace('podcst_migrations') AS ledger`)[0]
          .ledger,
      ).toBeNull();
    });

    test.each([
      'CREATE TABLE existing (id int)',
      'CREATE VIEW existing AS SELECT 1 AS id',
      "CREATE TYPE existing AS ENUM ('value')",
      "CREATE FUNCTION existing() RETURNS int LANGUAGE sql AS 'SELECT 1'",
    ])('refuses untracked objects: %s', async (statement) => {
      await sql.unsafe(statement);
      await expect(migrate(sql)).rejects.toThrow(
        'no reviewed migration baseline',
      );
    });

    test('does not mistake a user schema beginning with pg for a system schema', async () => {
      await sql.unsafe(
        'CREATE SCHEMA pgcustom; CREATE TABLE pgcustom.existing (id int);',
      );
      try {
        expect((await migrationStatus(sql)).state).toBe('untracked');
        await expect(migrate(sql)).rejects.toThrow(
          'no reviewed migration baseline',
        );
      } finally {
        await sql`DROP SCHEMA pgcustom CASCADE`;
      }
    });

    test('checksum drift refuses the entire pending plan before any mutation', async () => {
      await migrate(sql);
      const chain = files(
        { '0001-new.sql': 'CREATE TABLE not_applied (id int);' },
        `${baseline.source}\n`,
      );
      await expect(migrationStatus(sql, chain)).rejects.toThrow(
        'checksum changed',
      );
      await expect(migrate(sql, chain)).rejects.toThrow('checksum changed');
      expect(
        (await sql`SELECT to_regclass('public.not_applied') AS relation`)[0]
          .relation,
      ).toBeNull();
    });

    test('rejects inserting an earlier migration or removing an applied one', async () => {
      const second = 'CREATE TABLE second (id int);';
      await migrate(sql, files({ '0002-second.sql': second }));
      await expect(migrate(sql, files())).rejects.toThrow('not a prefix');
      await expect(
        migrate(
          sql,
          files({
            '0001-first.sql': 'CREATE TABLE first (id int);',
            '0002-second.sql': second,
          }),
        ),
      ).rejects.toThrow('not a prefix');
      expect(
        (await sql`SELECT to_regclass('public.first') AS relation`)[0].relation,
      ).toBeNull();
    });

    test('rejects unknown applied entries and empty ledgers', async () => {
      await migrate(sql);
      await sql`INSERT INTO podcst_migrations.history (name, checksum) VALUES ('9999-unknown.sql', ${'a'.repeat(64)})`;
      await expect(migrate(sql)).rejects.toThrow('not a prefix');
      await sql`DELETE FROM podcst_migrations.history`;
      await expect(migrate(sql)).rejects.toThrow('Empty migration ledger');
    });

    test('a failed baseline rolls back both its DDL and ledger', async () => {
      await expect(
        migrate(sql, files({}, 'CREATE TABLE partial (id int); SELECT 1 / 0;')),
      ).rejects.toThrow('division by zero');
      expect((await migrationStatus(sql)).state).toBe('empty');
      expect(
        (await sql`SELECT to_regclass('public.partial') AS relation`)[0]
          .relation,
      ).toBeNull();
      expect(await migrate(sql)).toEqual([baseline.name]);
    });

    test('a failed upgrade rolls back its schema, data and ledger entry and releases the lock', async () => {
      await migrate(sql);
      await sql.unsafe(seed);
      const broken = files({
        '0001-upgrade.sql':
          'ALTER TABLE users ADD COLUMN flag boolean; DELETE FROM playback_progress; SELECT 1 / 0;',
      });
      await expect(migrate(sql, broken)).rejects.toThrow('division by zero');
      expect(
        (await sql`SELECT position FROM playback_progress`)[0].position,
      ).toBe(123);
      expect(
        (await sql`SELECT count(*)::int AS n FROM podcst_migrations.history`)[0]
          .n,
      ).toBe(1);
      const repaired = files({
        '0001-upgrade.sql': 'ALTER TABLE users ADD COLUMN flag boolean;',
      });
      expect(await migrate(sql, repaired)).toEqual(['0001-upgrade.sql']);
    });

    test('all pending migrations commit or roll back as one batch', async () => {
      const broken = files({
        '0001-data.sql': seed,
        '0002-failure.sql': 'SELECT 1 / 0;',
      });
      await expect(migrate(sql, broken)).rejects.toThrow('division by zero');
      expect((await migrationStatus(sql)).state).toBe('empty');
      const repaired = files({ '0001-data.sql': seed });
      expect(await migrate(sql, repaired)).toEqual([
        baseline.name,
        '0001-data.sql',
      ]);
      expect(
        (await sql`SELECT position FROM playback_progress`)[0].position,
      ).toBe(123);
    });

    test('nontransactional operations fail closed without an exception flag', async () => {
      await migrate(sql);
      await expect(
        migrate(
          sql,
          files({
            '0001-index.sql':
              'CREATE INDEX CONCURRENTLY new_index ON users (email);',
          }),
        ),
      ).rejects.toThrow('cannot run inside a transaction');
      expect(
        (await sql`SELECT to_regclass('public.new_index') AS relation`)[0]
          .relation,
      ).toBeNull();
      expect(
        (await sql`SELECT count(*)::int AS n FROM podcst_migrations.history`)[0]
          .n,
      ).toBe(1);
    });

    test('records an online index and a repeated run leaves it unchanged', async () => {
      const chain = onlineChain();
      expect(await migrate(sql, chain)).toEqual([
        baseline.name,
        '0001-online-index.sql',
      ]);
      const [index] =
        await sql`SELECT indexrelid::text AS oid, indisvalid, indisready, pg_get_indexdef(indexrelid) AS definition
        FROM pg_index WHERE indexrelid = 'public.idx_episodes_podcast_published'::regclass`;
      expect(index.indisvalid).toBe(true);
      expect(index.indisready).toBe(true);
      expect(index.definition).toBe(
        'CREATE INDEX idx_episodes_podcast_published ON public.episodes USING btree (podcast_id, published DESC)',
      );
      expect(await migrate(sql, chain)).toEqual([]);
      expect(
        (
          await sql`SELECT 'public.idx_episodes_podcast_published'::regclass::oid::text AS oid`
        )[0].oid,
      ).toBe(index.oid);
    });

    test('resumes a completed build after the ledger insert fails', async () => {
      await migrate(sql);
      await sql.unsafe(`CREATE FUNCTION reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'interrupted ledger'; END $$;
        CREATE TRIGGER reject_history BEFORE INSERT ON podcst_migrations.history FOR EACH ROW EXECUTE FUNCTION reject_history();`);
      await expect(migrate(sql, onlineChain())).rejects.toThrow(
        'interrupted ledger',
      );
      const [index] =
        await sql`SELECT indexrelid::text AS oid, indisvalid FROM pg_index WHERE indexrelid = 'public.idx_episodes_podcast_published'::regclass`;
      expect(index.indisvalid).toBe(true);
      expect(
        (await migrationStatus(sql, onlineChain())).migrations[1].state,
      ).toBe('pending');
      await sql`DROP TRIGGER reject_history ON podcst_migrations.history`;
      expect(await migrate(sql, onlineChain())).toEqual([
        '0001-online-index.sql',
      ]);
      expect(
        (
          await sql`SELECT 'public.idx_episodes_podcast_published'::regclass::oid::text AS oid`
        )[0].oid,
      ).toBe(index.oid);
    });

    test.each([
      'CREATE INDEX idx_episodes_podcast_published ON episodes (published DESC, podcast_id)',
      'CREATE INDEX idx_episodes_podcast_published ON episodes (podcast_id, published)',
      'CREATE INDEX idx_episodes_podcast_published ON episodes (podcast_id, published DESC NULLS LAST)',
      'CREATE INDEX idx_episodes_podcast_published ON episodes (podcast_id, published DESC) INCLUDE (guid)',
      'CREATE INDEX idx_episodes_podcast_published ON episodes (podcast_id, published DESC) WHERE podcast_id > 0',
      'CREATE UNIQUE INDEX idx_episodes_podcast_published ON episodes (podcast_id, published DESC)',
      'CREATE INDEX idx_episodes_podcast_published ON episodes (podcast_id, published DESC) WITH (fillfactor=70)',
      'CREATE INDEX idx_episodes_podcast_published ON podcasts (id)',
      'CREATE TABLE idx_episodes_podcast_published (id int)',
    ])('refuses an existing mismatched relation without modifying it: %s', async (statement) => {
      await migrate(sql);
      await sql.unsafe(statement);
      const [before] =
        await sql`SELECT 'public.idx_episodes_podcast_published'::regclass::oid::text AS oid`;
      await expect(migrate(sql, onlineChain())).rejects.toThrow(
        'requires operator recovery',
      );
      expect(
        (
          await sql`SELECT 'public.idx_episodes_podcast_published'::regclass::oid::text AS oid`
        )[0].oid,
      ).toBe(before.oid);
      expect(
        (await migrationStatus(sql, onlineChain())).migrations[1].state,
      ).toBe('pending');
    });

    test('an online boundary preserves earlier commits and rolls back the later transactional batch', async () => {
      const chain = files({
        '0001-before.sql': 'CREATE TABLE before_online (id int);',
        '0002-online.sql': onlineIndex,
        '0003-after.sql': 'CREATE TABLE after_online (id int);',
        '0004-failure.sql': 'SELECT 1 / 0;',
      });
      await expect(migrate(sql, chain)).rejects.toThrow('division by zero');
      expect(
        (
          await sql`SELECT to_regclass('public.before_online') AS before, to_regclass('public.after_online') AS after`
        )[0],
      ).toEqual({ before: 'before_online', after: null });
      expect(
        (await migrationStatus(sql, chain)).migrations.map(
          ({ state }) => state,
        ),
      ).toEqual(['applied', 'applied', 'applied', 'pending', 'pending']);
    });

    test('checksum drift refuses online work before creating an index', async () => {
      await migrate(sql);
      await expect(
        migrate(
          sql,
          files({ '0001-online.sql': onlineIndex }, `${baseline.source}\n`),
        ),
      ).rejects.toThrow('checksum changed');
      expect(
        (
          await sql`SELECT to_regclass('public.idx_episodes_podcast_published') AS index`
        )[0].index,
      ).toBeNull();
    });

    test('schema fixtures can apply the active online index inside a transaction', async () => {
      await sql.begin(async (tx) => {
        await createSchemaFixture(tx);
        expect(
          (
            await tx`SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_episodes_podcast_published'::regclass`
          )[0].indisvalid,
        ).toBe(true);
      });
    });

    test('schema fixture indexes follow the fixture search path without touching public', async () => {
      await sql`CREATE TABLE public.episodes (sentinel text)`;
      await sql`INSERT INTO public.episodes VALUES ('preserve public')`;
      try {
        await sql.begin(async (tx) => {
          await tx`CREATE SCHEMA isolated_fixture`;
          await tx`SET LOCAL search_path TO isolated_fixture`;
          await createSchemaFixture(tx);
          expect(
            (
              await tx`SELECT indisvalid FROM pg_index
            WHERE indexrelid = 'isolated_fixture.idx_episodes_podcast_published'::regclass`
            )[0].indisvalid,
          ).toBe(true);
          expect(
            (
              await tx`SELECT to_regclass('public.idx_episodes_podcast_published') AS index`
            )[0].index,
          ).toBeNull();
        });
        expect(
          (await sql`SELECT sentinel FROM public.episodes`)[0].sentinel,
        ).toBe('preserve public');
      } finally {
        await sql`DROP SCHEMA IF EXISTS isolated_fixture CASCADE`;
      }
    });

    test('CLI rejects an invalid online timeout before applying migrations', async () => {
      const result = cli(['up'], cluster.url, undefined, '0');
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain('Online statement timeout');
      expect((await migrationStatus(sql)).state).toBe('empty');
    });

    test('CLI explains when an existing index needs operator recovery', async () => {
      const chain = loadMigrations();
      await applyMigrations(sql, chain.slice(0, -1));
      await sql`CREATE INDEX idx_episodes_podcast_published ON public.episodes (id)`;
      const result = cli(['up'], cluster.url);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain('requires operator recovery');
      expect((await inspectMigrations(sql)).migrations.at(-1)?.state).toBe(
        'pending',
      );
    });

    test('an old transaction lock excludes the new runner before it changes anything', async () => {
      await migrate(sql);
      const old = postgres(cluster.options);
      const held = await old.reserve();
      try {
        await held`BEGIN`;
        await lockMigrations(held);
        await expect(migrate(sql, onlineChain())).rejects.toThrow(
          'Another migration runner',
        );
        expect(
          (
            await sql`SELECT to_regclass('public.idx_episodes_podcast_published') AS index`
          )[0].index,
        ).toBeNull();
      } finally {
        await held`ROLLBACK`;
        held.release();
        await old.end();
      }
    });

    test('a canceled online build preserves rows and requires explicit concurrent drop before retry', async () => {
      await migrate(sql);
      await sql.unsafe(seed);
      const writer = postgres(cluster.options);
      const builder = postgres(cluster.options);
      const settings =
        () => builder`SELECT current_setting('search_path') AS search_path,
        current_setting('standard_conforming_strings') AS strings,
        current_setting('lock_timeout') AS lock_timeout,
        current_setting('statement_timeout') AS statement_timeout`;
      await builder.unsafe(
        "SET search_path TO pg_catalog, public; SET lock_timeout TO '17s'; SET statement_timeout TO '19s'; SET standard_conforming_strings TO off;",
      );
      const beforeSettings = Array.from(await settings());
      const held = await writer.reserve();
      try {
        await held`BEGIN`;
        await held`UPDATE episodes SET guid = guid WHERE id = 10`;
        await expect(
          applyMigrations(builder, onlineChain(), {
            onlineStatementTimeoutMs: 100,
          }),
        ).rejects.toThrow('statement timeout');
        expect(Array.from(await settings())).toEqual(beforeSettings);
        await sql.begin(async (tx) => {
          await lockMigrations(tx);
        });
        const [invalid] =
          await sql`SELECT indexrelid::text AS oid, indisvalid FROM pg_index WHERE indexrelid = 'public.idx_episodes_podcast_published'::regclass`;
        expect(invalid.indisvalid).toBe(false);
        await held`COMMIT`;
        await expect(migrate(builder, onlineChain())).rejects.toThrow(
          'requires operator recovery',
        );
        expect(
          (
            await sql`SELECT 'public.idx_episodes_podcast_published'::regclass::oid::text AS oid`
          )[0].oid,
        ).toBe(invalid.oid);
        expect(
          (await migrationStatus(sql, onlineChain())).migrations[1].state,
        ).toBe('pending');
        const rowsBefore = Array.from(
          await sql`SELECT e.*, p.position FROM episodes e JOIN playback_progress p ON p.episode_id = e.id`,
        );
        await sql`DROP INDEX CONCURRENTLY public.idx_episodes_podcast_published`;
        expect(await migrate(builder, onlineChain())).toEqual([
          '0001-online-index.sql',
        ]);
        expect(Array.from(await settings())).toEqual(beforeSettings);
        expect(
          Array.from(
            await sql`SELECT e.*, p.position FROM episodes e JOIN playback_progress p ON p.episode_id = e.id`,
          ),
        ).toEqual(rowsBefore);
      } finally {
        await held`ROLLBACK`;
        held.release();
        await writer.end();
        await builder.end();
      }
    });

    test.each([
      'transaction',
      'online',
    ])('backend loss during %s rejects without reusing the dead reserved connection', async (mode) => {
      await migrate(sql);
      await sql.unsafe(seed);
      const builder = postgres(cluster.options);
      const writer = postgres(cluster.options);
      const held = await writer.reserve();
      const [{ pid }] = await builder`SELECT pg_backend_pid() AS pid`;
      const chain =
        mode === 'online'
          ? onlineChain()
          : files({
              '0001-interrupted.sql':
                'SELECT pg_sleep(30); CREATE TABLE must_not_commit (id int);',
            });
      let running: Promise<unknown> | undefined;
      try {
        await held`BEGIN`;
        await held`UPDATE episodes SET guid = guid WHERE id = 10`;
        running = migrate(builder, chain).then(
          (result) => result,
          (error) => error,
        );
        const deadline = Date.now() + 2000;
        let active = false;
        while (Date.now() < deadline) {
          const [activity] = await sql`SELECT state = 'active' AND
              (query LIKE 'SELECT pg_sleep(30)%' OR query LIKE 'CREATE INDEX CONCURRENTLY%') AS active
              FROM pg_stat_activity WHERE pid = ${pid}`;
          if (activity?.active) {
            active = true;
            break;
          }
          await Bun.sleep(10);
        }
        expect(active).toBe(true);
        await sql`SELECT pg_terminate_backend(${pid})`;
        const result = await Promise.race([
          running,
          Bun.sleep(1000).then(() => 'still pending'),
        ]);
        expect(result).toBeInstanceOf(Error);
        await sql.begin(async (tx) => {
          await lockMigrations(tx);
        });
        expect((await migrationStatus(sql, chain)).migrations[1].state).toBe(
          'pending',
        );
        expect(
          (await sql`SELECT position FROM playback_progress`)[0].position,
        ).toBe(123);
      } finally {
        await builder.end({ timeout: 0 });
        await held`ROLLBACK`;
        held.release();
        await writer.end();
        await running;
      }
    });

    test('online builds permit writers while excluding both session and old transaction runners', async () => {
      await migrate(sql);
      await sql.unsafe(seed);
      const writer = postgres(cluster.options);
      const builder = postgres(cluster.options);
      const observer = postgres(cluster.options);
      const held = await writer.reserve();
      let running: Promise<string[]> | undefined;
      try {
        await held`BEGIN`;
        await held`UPDATE episodes SET guid = guid WHERE id = 10`;
        running = applyMigrations(builder, onlineChain(), {
          onlineStatementTimeoutMs: 4000,
        });
        // Observe the actual PostgreSQL phase; no timing assumption about build speed.
        const deadline = Date.now() + 2000;
        let waiting = false;
        while (Date.now() < deadline) {
          const [progress] =
            await observer`SELECT EXISTS (SELECT 1 FROM pg_stat_progress_create_index
            WHERE relid = 'public.episodes'::regclass AND phase = 'waiting for writers before build') AS waiting`;
          if (progress.waiting) {
            waiting = true;
            break;
          }
          await Bun.sleep(10);
        }
        expect(waiting).toBe(true);
        await observer.begin(async (tx) => {
          await tx`SET LOCAL statement_timeout TO '500ms'`;
          await tx`INSERT INTO episodes (id, podcast_id, guid, published) VALUES (11, 1, 'while-building', now())`;
        });
        await expect(migrate(observer, onlineChain())).rejects.toThrow(
          'Another migration runner',
        );
        await expect(
          observer.begin(async (tx) => {
            await lockMigrations(tx);
          }),
        ).rejects.toThrow('Another migration runner');
      } finally {
        await held`ROLLBACK`;
        held.release();
        await running;
        await writer.end();
        await builder.end();
        await observer.end();
      }
      expect(
        (await sql`SELECT count(*)::int AS count FROM episodes`)[0].count,
      ).toBe(2);
      expect(
        (await migrationStatus(sql, onlineChain())).migrations[1].state,
      ).toBe('applied');
    });

    test('a second runner fails while the first owns the transaction lock', async () => {
      await migrate(sql);
      const barrier = 192734;
      await sql`SELECT pg_advisory_lock(${barrier})`;
      const ready = Promise.withResolvers<void>();
      const first = postgres({
        ...cluster.options,
        debug: (_connection, query) => {
          if (query.includes(`pg_advisory_xact_lock(${barrier})`))
            ready.resolve();
        },
      });
      const second = postgres(cluster.options);
      const chain = files({
        '0001-concurrent.sql': `SELECT pg_advisory_xact_lock(${barrier}); CREATE TABLE once_only (id int);`,
      });
      const running = migrate(first, chain);
      try {
        await ready.promise;
        await expect(migrate(second, chain)).rejects.toThrow(
          'Another migration runner',
        );
        expect((await migrationStatus(second, chain)).migrations[1].state).toBe(
          'pending',
        );
      } finally {
        await sql`SELECT pg_advisory_unlock(${barrier})`;
        await running;
        await first.end();
        await second.end();
      }
      expect((await migrationStatus(sql, chain)).migrations[1].state).toBe(
        'applied',
      );
    });
  },
);
