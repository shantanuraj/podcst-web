import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  JOURNAL_GENESIS,
  type JournalHead,
  type Signed,
  verifyValue,
} from '../../src/server/erasure/journal-contract';
import { readProtected, writeProtected } from '../lib/artifacts';
import { startPostgres } from '../lib/postgres-sandbox';
import {
  type JournalConfiguration,
  journalConfigurationKeys,
} from './configuration';
import {
  type InitializationConfiguration,
  runInitializationCommand,
} from './initialize';
import { grantJournalStore } from './permissions';

if (process.env.REQUIRE_ERASURE_TESTS === '1' && !process.env.PG_BIN)
  throw new Error('PG_BIN required for erasure tests');

describe.skipIf(!process.env.PG_BIN)(
  'dormant co-located store initialization',
  () => {
    const names = ['journal', 'authority', 'receipts'] as const;
    let cluster: ReturnType<typeof startPostgres>;
    let admins: postgres.Sql[];
    let config: InitializationConfiguration;
    let service: JournalConfiguration;
    let directory: string;
    let reference: string;
    const input = (patch: Partial<InitializationConfiguration> = {}) => {
      const value = {
        ...config,
        ...patch,
        output: join(directory, `${randomUUID()}.json`),
      };
      const path = join(directory, `${randomUUID()}.config.json`);
      writeProtected(path, value);
      return { path, value };
    };
    const inspect = async () => {
      const { path, value } = input();
      await runInitializationCommand('inspect', path);
      config.inspection = value.output;
      return readProtected(value.output) as {
        state: string;
        configuration: string;
      };
    };
    const initialize = async (fault?: (point: string) => Promise<void>) => {
      const { path, value } = input();
      await runInitializationCommand('initialize', path, fault);
      return readProtected(value.output) as {
        state: string;
        head: Signed<JournalHead>;
      };
    };
    const empty = async () => {
      expect(await admins[0]`SELECT 1 FROM erasure_journal.head`).toHaveLength(
        0,
      );
      expect(
        await admins[0]`SELECT 1 FROM erasure_journal.epochs`,
      ).toHaveLength(0);
      expect(
        await admins[1]`SELECT 1 FROM erasure_authority.head`,
      ).toHaveLength(0);
    };
    beforeAll(async () => {
      cluster = startPostgres();
      await cluster.sql`CREATE TABLE kept (id int PRIMARY KEY)`;
      await cluster.sql`INSERT INTO kept VALUES (1)`;
      reference = join(cluster.directory, 'store-reference.json');
      const path = join(cluster.directory, 'reference-config.json');
      writeProtected(path, { pgBin: process.env.PG_BIN, output: reference });
      await runInitializationCommand('reference', path);
    }, 30_000);
    beforeEach(async () => {
      directory = join(cluster.directory, randomUUID());
      mkdirSync(directory, { mode: 0o700 });
      admins = [];
      for (const name of names) {
        const database = `store_${name}`;
        await cluster.sql`CREATE ROLE ${cluster.sql(database)} NOLOGIN NOINHERIT`;
        await cluster.sql`CREATE DATABASE ${cluster.sql(database)} TEMPLATE template0`;
        const admin = postgres({ ...cluster.options, database });
        admins.push(admin);
        await admin.unsafe(
          readFileSync(new URL(`./${name}.sql`, import.meta.url), 'utf8'),
        );
        await grantJournalStore(admin, name, { database, role: database });
      }
      const pair = generateKeyPairSync('ed25519');
      service = {
        port: 4311,
        journalId: randomUUID(),
        databases: Object.fromEntries(
          names.map((name) => [
            name,
            `postgres://store_${name}@localhost:${cluster.options.port}/store_${name}?host=${encodeURIComponent(cluster.directory)}`,
          ]),
        ) as JournalConfiguration['databases'],
        tokens: {
          admission: randomBytes(32).toString('base64url'),
          recovery: randomBytes(32).toString('base64url'),
        },
        keys: {
          current: 'synthetic',
          signing: pair.privateKey
            .export({ type: 'pkcs8', format: 'pem' })
            .toString(),
          versions: [
            {
              id: 'synthetic',
              encryption: randomBytes(32).toString('base64'),
              verification: pair.publicKey
                .export({ type: 'spki', format: 'pem' })
                .toString(),
            },
          ],
        },
      };
      const [identity] =
        await cluster.sql`SELECT system_identifier::text AS cluster FROM pg_control_system()`;
      config = {
        journalConfiguration: join(directory, 'journal.json'),
        target: {
          socket: cluster.directory,
          port: cluster.options.port,
          operator: 'postgres',
          cluster: identity.cluster,
        },
        epoch: randomUUID(),
        reference,
        intent: join(directory, 'intent.json'),
        output: join(directory, 'unused.json'),
      };
      writeProtected(config.journalConfiguration, service);
    });
    afterEach(async () => {
      await Promise.all(admins.map((sql) => sql.end({ timeout: 1 })));
      for (const name of names) {
        await cluster.sql`DROP DATABASE ${cluster.sql(`store_${name}`)} WITH (FORCE)`;
      }
      for (const name of names)
        await cluster.sql`DROP ROLE ${cluster.sql(`store_${name}`)}`;
      expect(Array.from(await cluster.sql`SELECT id FROM kept`)).toEqual([
        { id: 1 },
      ]);
    });
    afterAll(async () => {
      await cluster?.stop();
    });

    test('inspection is read-only and genesis leaves service roles dormant with no recovery evidence', async () => {
      expect((await inspect()).state).toBe('empty');
      await empty();
      const result = await initialize();
      expect(result.state).toBe('initialized');
      expect(
        verifyValue(
          result.head,
          journalConfigurationKeys(service).verification,
        ),
      ).toEqual({
        journalId: service.journalId,
        epoch: config.epoch,
        hash: JOURNAL_GENESIS,
        sequence: '0',
        revision: '0',
        sealed: false,
      });
      expect((readProtected(config.intent) as { state: string }).state).toBe(
        'empty',
      );
      for (const name of names) {
        const [role] =
          await cluster.sql`SELECT rolcanlogin, rolpassword IS NULL AS password_unset FROM pg_authid WHERE rolname = ${`store_${name}`}`;
        expect(role).toEqual({ rolcanlogin: false, password_unset: true });
      }
      for (const table of [
        'recovery_runs',
        'recovery_gate',
        'recovery_artifacts',
      ])
        expect(
          await admins[1]`SELECT 1 FROM ${admins[1](`erasure_authority.${table}`)}`,
        ).toHaveLength(0);
      expect(
        await admins[2]`SELECT 1 FROM erasure_receipts.receipts`,
      ).toHaveLength(0);
      await expect(initialize()).rejects.toThrow('inspection changed');
      expect((await inspect()).state).toBe('initialized');
      await expect(initialize()).rejects.toThrow('inspection refused');
    });

    test.each([
      'after-journal-commit',
      'before-authority-commit',
      'after-authority-commit',
    ])('%s preserves the same genesis and requires fresh inspection for completion', async (point) => {
      await inspect();
      const attempt = input();
      await expect(
        runInitializationCommand('initialize', attempt.path, async (at) => {
          if (at === point) throw new Error('Synthetic lost acknowledgement');
        }),
      ).rejects.toThrow('Synthetic lost acknowledgement');
      expect(existsSync(attempt.value.output)).toBe(false);
      expect(existsSync(`${attempt.value.output}.attempt`)).toBe(true);
      expect(await admins[0]`SELECT 1 FROM erasure_journal.head`).toHaveLength(
        1,
      );
      await expect(initialize()).rejects.toThrow();
      await expect(
        runInitializationCommand('complete-authority', input().path),
      ).rejects.toThrow('inspection refused');
      expect((await inspect()).state).toBe(
        point === 'after-authority-commit' ? 'initialized' : 'journal-only',
      );
      const completion = input();
      await runInitializationCommand('complete-authority', completion.path);
      expect(
        (readProtected(completion.value.output) as { state: string }).state,
      ).toBe('initialized');
      expect(
        await admins[0]`SELECT 1 FROM erasure_journal.epochs`,
      ).toHaveLength(1);
      expect(
        await admins[1]`SELECT 1 FROM erasure_authority.head`,
      ).toHaveLength(1);
      await expect(
        runInitializationCommand('complete-authority', completion.path),
      ).rejects.toThrow('output already exists');
    });

    test('pre-commit interruption retains its intent and never silently restarts initialization', async () => {
      await inspect();
      await expect(
        initialize(async (point) => {
          if (point === 'before-journal-commit')
            throw new Error('Synthetic stop');
        }),
      ).rejects.toThrow('Synthetic stop');
      await empty();
      expect((await inspect()).state).toBe('empty');
      await expect(initialize()).rejects.toThrow();
      await expect(
        runInitializationCommand('complete-authority', input().path),
      ).rejects.toThrow('inspection refused');
      await empty();
    });

    test('simultaneous operators cannot both initialize from the same observation', async () => {
      await inspect();
      const outcomes = await Promise.allSettled([initialize(), initialize()]);
      expect(
        outcomes.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        outcomes.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
      expect((await inspect()).state).toBe('initialized');
      expect(
        await admins[0]`SELECT 1 FROM erasure_journal.epochs`,
      ).toHaveLength(1);
    });

    test.each([
      'grant',
      'missing-grant',
      'schema',
      'receipt',
      'login',
      'sibling',
      'public',
      'membership',
      'grant-option',
    ])('%s drift refuses without repairing stores or creating genesis', async (drift) => {
      await inspect();
      if (drift === 'grant')
        await admins[0]`GRANT UPDATE (body) ON erasure_journal.entries TO store_journal`;
      if (drift === 'missing-grant')
        await admins[0]`REVOKE UPDATE ON erasure_journal.head FROM store_journal`;
      if (drift === 'schema')
        await admins[0]`ALTER TABLE erasure_journal.entries ADD COLUMN unexpected int`;
      if (drift === 'receipt')
        await admins[2]`INSERT INTO erasure_receipts.receipts VALUES (${'a'.repeat(64)}, ${randomUUID()}, now() + interval '1 hour')`;
      if (drift === 'login')
        await cluster.sql`ALTER ROLE store_authority LOGIN`;
      if (drift === 'sibling')
        await admins[1]`GRANT CONNECT ON DATABASE store_authority TO store_journal`;
      if (drift === 'public')
        await admins[0]`GRANT SELECT ON erasure_journal.head TO PUBLIC`;
      if (drift === 'membership')
        await cluster.sql`GRANT store_journal TO store_authority`;
      if (drift === 'grant-option')
        await admins[0]`GRANT SELECT ON erasure_journal.head TO store_journal WITH GRANT OPTION`;
      await expect(initialize()).rejects.toThrow();
      await empty();
      expect(existsSync(config.intent)).toBe(false);
    });

    test('changed cluster, key, journal identity or service URL cannot reuse an inspection', async () => {
      await inspect();
      const wrongTarget = input({ target: { ...config.target, cluster: '1' } });
      await expect(
        runInitializationCommand('initialize', wrongTarget.path),
      ).rejects.toThrow('inspection refused');
      for (const changed of [
        { ...service, journalId: randomUUID() },
        {
          ...service,
          keys: {
            ...service.keys,
            versions: [
              {
                ...service.keys.versions[0],
                encryption: randomBytes(32).toString('base64'),
              },
            ],
          },
        },
        {
          ...service,
          keys: {
            ...service.keys,
            versions: [...service.keys.versions, service.keys.versions[0]],
          },
        },
        {
          ...service,
          databases: {
            ...service.databases,
            journal: 'postgres://store_journal@localhost:5432/store_journal',
          },
        },
      ]) {
        const journalConfiguration = join(directory, `${randomUUID()}.json`);
        writeProtected(journalConfiguration, changed);
        await expect(
          runInitializationCommand(
            'initialize',
            input({ journalConfiguration }).path,
          ),
        ).rejects.toThrow();
      }
      await empty();
    });

    test('a replacement database cannot reuse an earlier inspection', async () => {
      await inspect();
      await admins[0].end({ timeout: 1 });
      await cluster.sql`DROP DATABASE store_journal`;
      await cluster.sql`CREATE DATABASE store_journal TEMPLATE template0`;
      admins[0] = postgres({ ...cluster.options, database: 'store_journal' });
      await admins[0].unsafe(
        readFileSync(new URL('./journal.sql', import.meta.url), 'utf8'),
      );
      await grantJournalStore(admins[0], 'journal', {
        database: 'store_journal',
        role: 'store_journal',
      });
      await expect(initialize()).rejects.toThrow('inspection changed');
      await empty();
      expect(existsSync(config.intent)).toBe(false);
    });

    test('wrong cluster and mismatched signing keys refuse initial inspection', async () => {
      await expect(
        runInitializationCommand(
          'inspect',
          input({ target: { ...config.target, cluster: '1' } }).path,
        ),
      ).rejects.toThrow('identity refused');
      const journalConfiguration = join(directory, 'wrong-keys.json');
      const pair = generateKeyPairSync('ed25519');
      writeProtected(journalConfiguration, {
        ...service,
        keys: {
          ...service.keys,
          signing: pair.privateKey
            .export({ type: 'pkcs8', format: 'pem' })
            .toString(),
        },
      });
      await expect(
        runInitializationCommand(
          'inspect',
          input({ journalConfiguration }).path,
        ),
      ).rejects.toThrow();
      await empty();
    });

    test('advanced heads and missing intents cannot be completed as genesis', async () => {
      await inspect();
      await expect(
        initialize(async (point) => {
          if (point === 'after-journal-commit')
            throw new Error('Synthetic stop');
        }),
      ).rejects.toThrow();
      await inspect();
      renameSync(config.intent, `${config.intent}.kept`);
      await expect(
        runInitializationCommand('complete-authority', input().path),
      ).rejects.toThrow();
      renameSync(`${config.intent}.kept`, config.intent);
      await admins[0]`UPDATE erasure_journal.head SET revision = 1, sealed = true`;
      await expect(
        runInitializationCommand('complete-authority', input().path),
      ).rejects.toThrow('head refused');
      expect(
        await admins[1]`SELECT 1 FROM erasure_authority.head`,
      ).toHaveLength(0);
    });

    test('a terminated operator and the bundled CLI preserve and complete the journal-only commit', async () => {
      await inspect();
      const attempt = input();
      const crashScript = join(directory, 'crash.ts');
      writeFileSync(
        crashScript,
        `import { runInitializationCommand } from ${JSON.stringify(new URL('./initialize.ts', import.meta.url).pathname)};
await runInitializationCommand('initialize', process.argv[2], async point => { if (point === 'after-journal-commit') process.exit(77); });`,
        { mode: 0o600 },
      );
      const crash = Bun.spawn(
        [process.execPath, '--no-env-file', crashScript, attempt.path],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      expect(await crash.exited).toBe(77);
      expect((await inspect()).state).toBe('journal-only');
      const bundleDir = join(
        cluster.directory,
        'bundle',
        'scripts',
        'erasure-journal',
      );
      mkdirSync(bundleDir, { recursive: true, mode: 0o700 });
      const bundle = join(bundleDir, 'initialize.js');
      const build = Bun.spawnSync(
        [
          process.execPath,
          '--no-env-file',
          'build',
          new URL('./initialize.ts', import.meta.url).pathname,
          '--target=bun',
          '--env=disable',
          '--outfile',
          bundle,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      expect(build.exitCode).toBe(0);
      for (const name of names)
        writeFileSync(
          join(bundleDir, `${name}.sql`),
          readFileSync(new URL(`./${name}.sql`, import.meta.url)),
          { mode: 0o600 },
        );
      const completion = input();
      const run = Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          bundle,
          'complete-authority',
          '--config',
          completion.path,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      expect(await run.exited).toBe(0);
      expect(
        (readProtected(completion.value.output) as { state: string }).state,
      ).toBe('initialized');
      const output = await new Response(run.stdout).text();
      expect(output).not.toContain(service.tokens.recovery);
      expect(output).not.toContain(service.keys.versions[0].encryption);
    }, 30_000);
  },
);
