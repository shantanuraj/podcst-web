import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  assertWritersFenced,
  recoverySchema,
} from '../src/server/erasure/recovery-database';
import { selectedRecoveryTables } from './backup-selection';
import { readProtected, writeProtected } from './lib/artifacts';
import { startPostgres } from './lib/postgres-sandbox';
import { migrate } from './migrations';
import {
  grantPrimaryRole,
  inspectPrimaryRole,
  runPrimaryGrantCommand,
  servingLockColumns,
  servingTablePermissions,
} from './recovery-permissions';

if (process.env.REQUIRE_ERASURE_TESTS === '1' && !process.env.PG_BIN)
  throw new Error('PG_BIN required for primary grant tests');

describe.skipIf(!process.env.PG_BIN)(
  'restricted primary serving and backup roles',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let reference: Awaited<ReturnType<typeof recoverySchema>>;
    let clients: postgres.Sql[];
    const target = (role = 'serving') => ({
      database: 'primary_fixture',
      role,
      reference,
    });
    const client = (role: string) => {
      const db = postgres({
        ...cluster.options,
        database: 'primary_fixture',
        username: role,
      });
      clients.push(db);
      return db;
    };
    beforeAll(async () => {
      cluster = startPostgres();
      await cluster.sql`CREATE ROLE unrelated LOGIN NOINHERIT`;
    });
    beforeEach(async () => {
      clients = [];
      await cluster.sql`CREATE DATABASE primary_fixture TEMPLATE template0`;
      await cluster.sql`REVOKE ALL ON DATABASE primary_fixture FROM PUBLIC`;
      await cluster.sql`CREATE ROLE serving NOLOGIN NOINHERIT`;
      await cluster.sql`CREATE ROLE backup NOLOGIN NOINHERIT`;
      sql = postgres({ ...cluster.options, database: 'primary_fixture' });
      await migrate(sql);
      reference = await recoverySchema(sql);
    });
    afterEach(async () => {
      await Promise.all([sql, ...clients].map((db) => db.end({ timeout: 1 })));
      await cluster.sql`DROP DATABASE primary_fixture WITH (FORCE)`;
      for (const role of ['serving', 'backup']) {
        await cluster.sql`DROP OWNED BY ${cluster.sql(role)}`;
        await cluster.sql`DROP ROLE ${cluster.sql(role)}`;
      }
    });
    afterAll(async () => {
      await cluster?.stop();
    });

    test('explicit serving matrix preserves column locks without ownership, control writes or ledger access', async () => {
      await grantPrimaryRole(sql, 'serving', target());
      await inspectPrimaryRole(sql, 'serving', target());
      await grantPrimaryRole(sql, 'serving', target());
      for (const [table, allowed] of Object.entries(servingTablePermissions)) {
        for (const privilege of [
          'SELECT',
          'INSERT',
          'UPDATE',
          'DELETE',
          'TRUNCATE',
          'REFERENCES',
          'TRIGGER',
        ]) {
          const [access] =
            await sql`SELECT has_table_privilege('serving', ${`public.${table}`}, ${privilege}) AS allowed`;
          expect(access.allowed).toBe(
            (allowed as readonly string[]).includes(privilege),
          );
        }
      }
      for (const [table, columns] of Object.entries(servingLockColumns))
        for (const column of columns)
          expect(
            (
              await sql`SELECT has_column_privilege('serving', ${`public.${table}`}, ${column}, 'UPDATE') AS allowed`
            )[0].allowed,
          ).toBe(true);
      const [role] =
        await sql`SELECT rolcanlogin, rolinherit, rolsuper FROM pg_roles WHERE rolname = 'serving'`;
      expect(role).toEqual({
        rolcanlogin: false,
        rolinherit: false,
        rolsuper: false,
      });
      await sql`ALTER ROLE serving LOGIN`;
      const runtime = client('serving');
      expect(
        await runtime`SELECT system_identifier FROM pg_control_system()`,
      ).toHaveLength(1);
      await runtime.begin(
        (tx) => tx`SELECT singleton FROM state_generation FOR SHARE`,
      );
      for (const query of [
        runtime`SELECT 1 FROM podcst_migrations.history`,
        runtime`UPDATE recovery_state SET sequence = 0`,
        runtime`UPDATE state_generation SET legacy_generation = generation`,
        runtime`UPDATE state_generation SET generation = legacy_generation`,
        runtime`UPDATE users SET name = 'unapproved'`,
        runtime`TRUNCATE authors`,
        runtime`CREATE TABLE unapproved (id int)`,
        runtime`CREATE TEMP TABLE unapproved (id int)`,
        runtime`SELECT 1 FROM oauth_accounts`,
        runtime`SELECT 1 FROM transcripts`,
        runtime`SELECT setval('authors_id_seq', 9000)`,
        runtime`SET session_replication_role = replica`,
      ])
        await expect(query.execute()).rejects.toThrow('permission denied');
      expect(
        (await runtime`SELECT nextval('authors_id_seq')::text AS id`)[0].id,
      ).toBe('1');
      await inspectPrimaryRole(sql, 'serving', target());
      await expect(grantPrimaryRole(sql, 'serving', target())).rejects.toThrow(
        'role refused',
      );
    });

    test('selected backup grants are read-only, include the ledger and work with real pg_dump', async () => {
      await grantPrimaryRole(sql, 'backup', target('backup'));
      await inspectPrimaryRole(sql, 'backup', target('backup'));
      await sql`INSERT INTO users (id,email) VALUES ('saved','saved@example.invalid')`;
      await sql`ALTER ROLE backup LOGIN`;
      const backup = client('backup');
      expect(
        await backup`SELECT name FROM podcst_migrations.history`,
      ).toHaveLength(15);
      for (const query of [
        backup`UPDATE users SET id = id`,
        backup`UPDATE state_generation SET singleton = singleton`,
        backup`SELECT nextval('authors_id_seq')`,
        backup`SELECT 1 FROM poll_metrics`,
      ])
        await expect(query.execute()).rejects.toThrow('permission denied');
      const result = Bun.spawnSync(
        [
          join(process.env.PG_BIN ?? '', 'pg_dump'),
          '-h',
          cluster.directory,
          '-p',
          String(cluster.options.port),
          '-U',
          'backup',
          '-d',
          'primary_fixture',
          '-Fc',
          '--no-owner',
          '--no-privileges',
          '--no-password',
          '--strict-names',
          ...selectedRecoveryTables().flatMap((name) => ['-t', name]),
        ],
        {
          env: {
            PATH: process.env.PATH,
            PGPASSFILE: join(cluster.directory, 'absent.pgpass'),
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      expect({
        exit: result.exitCode,
        error: result.stderr.toString(),
      }).toEqual({ exit: 0, error: '' });
      expect(result.stdout.length).toBeGreaterThan(1000);
      await expect(assertWritersFenced(sql, [])).rejects.toThrow();
      await backup.end({ timeout: 1 });
      await sql`ALTER ROLE backup NOLOGIN`;
      await assertWritersFenced(sql, []);
      expect(
        (
          await sql`SELECT rolcanlogin, has_database_privilege('unrelated','postgres','CONNECT') AS outside, has_database_privilege('unrelated','primary_fixture','CONNECT') AS primary FROM pg_roles WHERE rolname = 'unrelated'`
        )[0],
      ).toEqual({ rolcanlogin: true, outside: true, primary: false });
    });

    test.each([
      'LOGIN',
      'INHERIT',
      'membership',
      'member',
      'owner',
      'temporary',
      'schema-create',
      'control-column',
      'column-grant-option',
      'table-grant-option',
      'truncate',
      'sequence-update',
      'ledger',
      'function-grant-option',
      'function-execute',
      'replication-bypass',
      'parameter',
      'schema-drift',
      'guard-drift',
    ])('%s refuses the entire transaction without repairing excess rights', async (kind) => {
      if (kind === 'LOGIN') await sql`ALTER ROLE serving LOGIN`;
      if (kind === 'INHERIT') await sql`ALTER ROLE serving INHERIT`;
      if (kind === 'membership') await sql`GRANT backup TO serving`;
      if (kind === 'member') await sql`GRANT serving TO backup`;
      if (kind === 'owner') await sql`ALTER TABLE authors OWNER TO serving`;
      if (kind === 'temporary')
        await sql`GRANT TEMPORARY ON DATABASE primary_fixture TO serving`;
      if (kind === 'schema-create')
        await sql`GRANT CREATE ON SCHEMA public TO PUBLIC`;
      if (kind === 'control-column')
        await sql`GRANT UPDATE (generation) ON state_generation TO serving`;
      if (kind === 'column-grant-option')
        await sql`GRANT UPDATE (id) ON users TO serving WITH GRANT OPTION`;
      if (kind === 'table-grant-option')
        await sql`GRANT SELECT ON passkeys TO serving WITH GRANT OPTION`;
      if (kind === 'truncate') await sql`GRANT TRUNCATE ON users TO serving`;
      if (kind === 'sequence-update')
        await sql`GRANT UPDATE ON authors_id_seq TO serving`;
      if (kind === 'ledger')
        await sql`GRANT SELECT ON podcst_migrations.history TO serving`;
      if (kind === 'function-grant-option')
        await sql`GRANT EXECUTE ON FUNCTION require_recovery_admission() TO serving WITH GRANT OPTION`;
      if (kind === 'function-execute')
        await sql`GRANT EXECUTE ON FUNCTION pg_read_file(text) TO serving`;
      if (kind === 'replication-bypass')
        await sql`ALTER ROLE serving BYPASSRLS`;
      if (kind === 'parameter')
        await sql`GRANT SET ON PARAMETER session_replication_role TO serving`;
      if (kind === 'schema-drift')
        await sql`ALTER TABLE users ADD COLUMN unexpected int`;
      if (kind === 'guard-drift')
        await sql`ALTER TABLE users DISABLE TRIGGER recovery_admission`;
      const [before] =
        await sql`SELECT relacl::text AS acl FROM pg_class WHERE oid = 'public.users'::regclass`;
      await expect(
        grantPrimaryRole(sql, 'serving', target()),
      ).rejects.toThrow();
      expect(
        (
          await sql`SELECT relacl::text AS acl FROM pg_class WHERE oid = 'public.users'::regclass`
        )[0].acl,
      ).toBe(before.acl);
      expect(
        (
          await sql`SELECT has_table_privilege('serving','account_preferences','INSERT') AS inserted`
        )[0].inserted,
      ).toBe(false);
      expect(
        (
          await sql`SELECT has_database_privilege('serving',current_database(),'CONNECT') AS connect`
        )[0].connect,
      ).toBe(false);
    });

    test('wrong database and reference refuse before grants; inspection never repairs missing rights', async () => {
      await expect(
        grantPrimaryRole(sql, 'serving', { ...target(), database: 'wrong' }),
      ).rejects.toThrow('role refused');
      await expect(
        grantPrimaryRole(sql, 'serving', {
          ...target(),
          reference: { ...reference, catalogHash: '0'.repeat(64) },
        }),
      ).rejects.toThrow('schema refused');
      await expect(
        inspectPrimaryRole(sql, 'serving', target()),
      ).rejects.toThrow('Missing');
      expect(
        (
          await sql`SELECT has_table_privilege('serving','users','SELECT') AS allowed`
        )[0].allowed,
      ).toBe(false);
      await grantPrimaryRole(sql, 'serving', target());
      await sql`REVOKE UPDATE (singleton) ON state_generation FROM serving`;
      await expect(
        inspectPrimaryRole(sql, 'serving', target()),
      ).rejects.toThrow('lock privileges');
      expect(
        (
          await sql`SELECT has_column_privilege('serving','state_generation','singleton','UPDATE') AS allowed`
        )[0].allowed,
      ).toBe(false);
    });

    test('the bundled operator command pins the cluster and retains a protected grant receipt', async () => {
      const directory = join(cluster.directory, 'operator');
      mkdirSync(directory, { mode: 0o700 });
      const packet = join(cluster.directory, 'packet');
      mkdirSync(join(packet, 'scripts'), { recursive: true });
      cpSync(
        new URL('../migrations', import.meta.url),
        join(packet, 'migrations'),
        { recursive: true },
      );
      cpSync(
        new URL('./podcst-backup.sh', import.meta.url),
        join(packet, 'scripts', 'podcst-backup.sh'),
      );
      const bundle = join(packet, 'scripts', 'recovery-permissions.js');
      const build = Bun.spawnSync(
        [
          process.execPath,
          '--no-env-file',
          'build',
          new URL('./recovery-permissions.ts', import.meta.url).pathname,
          '--target=bun',
          '--env=disable',
          '--outfile',
          bundle,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      expect(build.exitCode).toBe(0);
      const referencePath = join(directory, 'reference.json');
      writeProtected(referencePath, reference);
      const output = join(directory, 'result.json');
      const path = join(directory, 'config.json');
      const [identity] =
        await sql`SELECT system_identifier::text AS cluster FROM pg_control_system()`;
      const config = {
        target: {
          socket: cluster.directory,
          port: cluster.options.port,
          operator: 'postgres',
          database: 'primary_fixture',
          cluster: identity.cluster,
        },
        profile: 'serving',
        role: 'serving',
        reference: referencePath,
        output,
      };
      writeProtected(path, config);
      const wrong = join(directory, 'wrong.json');
      writeProtected(wrong, {
        ...config,
        target: { ...config.target, cluster: '1' },
      });
      await expect(runPrimaryGrantCommand('grant', wrong)).rejects.toThrow(
        'identity refused',
      );
      const child = Bun.spawn(
        [process.execPath, '--no-env-file', bundle, 'grant', '--config', path],
        {
          env: { PATH: process.env.PATH, HOME: directory },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      expect({
        exit: await child.exited,
        error: await new Response(child.stderr).text(),
      }).toEqual({ exit: 0, error: '' });
      expect(readProtected(output)).toMatchObject({
        profile: 'serving',
        role: 'serving',
        verified: true,
      });
      await expect(runPrimaryGrantCommand('grant', path)).rejects.toThrow(
        'output exists',
      );
      await inspectPrimaryRole(sql, 'serving', target());
    }, 30_000);
  },
);
