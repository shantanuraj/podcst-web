import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import {
  chmodSync,
  closeSync,
  existsSync,
  ftruncateSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { readProtected, stable, writeProtected } from './lib/artifacts';
import { startPostgres } from './lib/postgres-sandbox';
import { loadMigrations, migrate } from './migrations';
import {
  artifactLimit,
  captureSchema,
  compareSchemas,
  inventoryArtifact,
  type SchemaSnapshot,
  validateInventory,
} from './schema-catalog';

const directories: string[] = [];
function directory(parent = tmpdir()) {
  const path = mkdtempSync(join(parent, 'podcst-inventory-'));
  chmodSync(path, 0o700);
  directories.push(path);
  return path;
}
afterAll(() => {
  for (const path of directories)
    rmSync(path, { recursive: true, force: true });
});

const manifest = loadMigrations().map(({ name, checksum }) => ({
  name,
  checksum,
}));
const empty: SchemaSnapshot = {
  database: {
    name: 'synthetic',
    serverVersion: 160000,
    role: 'operator',
    encoding: 'UTF8',
    collation: 'C',
    ctype: 'C',
    localeProvider: 'c',
    locale: null,
    collationVersion: null,
    ledgerPresent: false,
  },
  objects: [],
  estimates: [],
};

function cli(args: readonly string[], target = '') {
  return Bun.spawnSync(
    [process.execPath, resolve('scripts/schema-inventory.ts'), ...args],
    {
      env: {
        ...process.env,
        SCHEMA_DATABASE_URL: target,
        DATABASE_URL: 'postgres://must-not-be-used.invalid/app',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
}

function comparisonFiles() {
  const root = directory();
  const expected = join(root, 'reference.json');
  const actual = join(root, 'capture.json');
  const output = join(root, 'comparison.json');
  writeProtected(expected, inventoryArtifact(empty, manifest));
  writeProtected(actual, inventoryArtifact(empty));
  return { expected, actual, output };
}

describe('schema artifacts and offline comparison', () => {
  test('comparison needs no database and never approves adoption', () => {
    const { expected, actual, output } = comparisonFiles();
    const result = cli(
      [
        'compare',
        '--expected',
        expected,
        '--actual',
        actual,
        '--output',
        output,
      ],
      'not a database URL',
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      schemaMatches: true,
      adoptionApproved: false,
    });
    expect(readProtected(output).adoptionApproved).toBe(false);
    expect(statSync(output).mode & 0o777).toBe(0o600);
  });

  test('fingerprints ignore capture time, database identity and estimates', () => {
    const reference = inventoryArtifact(empty, manifest);
    const actual = inventoryArtifact({
      ...empty,
      database: { ...empty.database, name: 'different', role: 'reader' },
      estimates: [{ estimatedRows: '9007199254740993' }],
    });
    const result = compareSchemas(reference, actual);
    expect(result.schemaMatches).toBe(true);
    expect(result.expectedSchemaDigest).toBe(result.actualSchemaDigest);
    expect(result.adoptionApproved).toBe(false);
  });

  test('server-major and collation differences require environment review', () => {
    const actual = inventoryArtifact({
      ...empty,
      database: {
        ...empty.database,
        serverVersion: 170000,
        collation: 'different',
      },
    });
    const result = compareSchemas(inventoryArtifact(empty, manifest), actual);
    expect(result.schemaMatches).toBe(true);
    expect(result.environment.matches).toBe(false);
  });

  test('rejects stale references, swapped artifacts and corrupted digests', () => {
    expect(() =>
      compareSchemas(inventoryArtifact(empty, []), inventoryArtifact(empty)),
    ).toThrow('current active migrations');
    expect(() =>
      compareSchemas(
        inventoryArtifact(empty),
        inventoryArtifact(empty, manifest),
      ),
    ).toThrow('reference');
    const artifact = inventoryArtifact(empty);
    artifact.inventory.snapshot = {
      ...empty,
      database: { ...empty.database, name: 'tampered' },
    };
    expect(() => validateInventory(artifact)).toThrow('digest');
    expect(() => validateInventory({})).toThrow('Invalid schema inventory');
  });

  test('refuses duplicate objects and excessive object counts', () => {
    const object = {
      kind: 'relation',
      schema: 'public',
      parent: '',
      name: 'synthetic',
      definition: {},
      access: null,
      manualReview: false,
    };
    expect(() =>
      validateInventory(
        inventoryArtifact({ ...empty, objects: [object, object] }),
      ),
    ).toThrow('duplicate');
    expect(() =>
      validateInventory(
        inventoryArtifact({ ...empty, objects: Array(10_001).fill(object) }),
      ),
    ).toThrow('Invalid schema inventory');
  });

  test('refuses public directories and files, symlinks, oversized inputs and overwrite', () => {
    const root = directory();
    const path = join(root, 'private.json');
    writeProtected(path, { synthetic: true });
    expect(() => writeProtected(path, { synthetic: false })).toThrow();
    expect(readProtected(path)).toEqual({ synthetic: true });
    chmodSync(path, 0o644);
    expect(() => readProtected(path)).toThrow('private regular file');
    chmodSync(path, 0o600);
    symlinkSync(path, join(root, 'link.json'));
    expect(() => readProtected(join(root, 'link.json'))).toThrow();
    const fd = openSync(join(root, 'large.json'), 'wx', 0o600);
    try {
      ftruncateSync(fd, artifactLimit + 1);
    } finally {
      closeSync(fd);
    }
    expect(() =>
      readProtected(join(root, 'large.json'), artifactLimit),
    ).toThrow('size limit');
    chmodSync(root, 0o755);
    expect(() => writeProtected(join(root, 'new.json'), {})).toThrow(
      'directory must be private',
    );
  });

  test('rejects repository artifacts and duplicate flags before connecting', () => {
    const output = join(directory(resolve('.')), 'inventory.json');
    const blocked = cli(['capture', '--output', output]);
    expect(blocked.stderr.toString()).toContain('outside the repository');
    expect(existsSync(output)).toBe(false);
    const root = directory();
    const duplicate = cli([
      'compare',
      '--output',
      join(root, 'out'),
      '--actual',
      'a',
      '--output',
      'b',
    ]);
    expect(duplicate.stderr.toString()).toContain('duplicate');
  });

  test('capture requires an explicit target and never falls back to app settings', () => {
    const output = join(directory(), 'inventory.json');
    const result = cli(['capture', '--output', output]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('SCHEMA_DATABASE_URL');
    expect(result.stderr.toString()).not.toContain('must-not-be-used');
    expect(existsSync(output)).toBe(false);
  });

  test('existing outputs are refused before a target is opened', () => {
    const output = join(directory(), 'inventory.json');
    writeProtected(output, { sentinel: true });
    expect(cli(['capture', '--output', output]).stderr.toString()).toContain(
      'already exists',
    );
    expect(readProtected(output)).toEqual({ sentinel: true });
  });
});

describe.skipIf(!process.env.PG_BIN)(
  'metadata-only PostgreSQL inventory',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let baseline: SchemaSnapshot;

    beforeAll(async () => {
      cluster = startPostgres();
      sql = cluster.sql;
      await sql`CREATE ROLE inventory_reader LOGIN`;
      await sql`ALTER ROLE inventory_reader SET default_transaction_read_only = on`;
    }, 30_000);
    afterAll(async () => {
      await cluster?.stop();
    });
    beforeEach(async () => {
      await sql.unsafe(
        'DROP SCHEMA IF EXISTS podcst_migrations CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;',
      );
      await migrate(sql);
      baseline = await captureSchema(sql);
    });

    test('catalog reader needs no application-table or sequence read privileges', async () => {
      await sql`INSERT INTO authors (name) VALUES ('synthetic-sensitive-record')`;
      await sql`INSERT INTO users (id, email) VALUES ('synthetic-sensitive-record', 'secret@example.invalid')`;
      const before =
        await sql`SELECT last_value, is_called FROM authors_id_seq`;
      const statements: string[] = [];
      const reader = postgres({
        ...cluster.options,
        username: 'inventory_reader',
        debug: (_id, query) => statements.push(query),
      });
      try {
        expect(
          (
            await reader`SELECT has_table_privilege(current_user, 'public.users', 'SELECT') AS allowed`
          )[0].allowed,
        ).toBe(false);
        await expect(
          reader`SELECT * FROM public.users`.execute(),
        ).rejects.toThrow('permission denied');
        statements.length = 0;
        const snapshot = await captureSchema(reader);
        expect(stable(snapshot)).not.toContain('synthetic-sensitive-record');
        expect(stable(snapshot)).not.toContain('secret@example.invalid');
        expect(snapshot.database.role).toBe('inventory_reader');
        expect(statements.join('\n')).toContain('read only');
        expect(statements.join('\n')).toContain("statement_timeout TO '10s'");
        expect(statements.join('\n')).not.toMatch(/(?:FROM|JOIN)\s+public\./i);
        expect(statements.join('\n')).not.toMatch(
          /\b(?:nextval|setval|pg_total_relation_size|pg_relation_size|pg_database_size)\s*\(/i,
        );
        expect(
          compareSchemas(
            inventoryArtifact(baseline, manifest),
            inventoryArtifact(snapshot),
          ).schemaMatches,
        ).toBe(true);
      } finally {
        await reader.end();
      }
      expect(
        Array.from(await sql`SELECT last_value, is_called FROM authors_id_seq`),
      ).toEqual(Array.from(before));
      expect((await sql`SELECT count(*)::int AS n FROM users`)[0].n).toBe(1);
    });

    test('statistics and sequence current values never change the structural fingerprint', async () => {
      await sql`INSERT INTO authors (name) SELECT 'author-' || n FROM generate_series(1, 100) n`;
      await sql`ANALYZE authors`;
      const snapshot = await captureSchema(sql);
      const result = compareSchemas(
        inventoryArtifact(baseline, manifest),
        inventoryArtifact(snapshot),
      );
      expect(result.schemaMatches).toBe(true);
      expect(result.expectedSchemaDigest).toBe(result.actualSchemaDigest);
      expect(
        snapshot.estimates.find((row) => row.name === 'authors')?.estimatedRows,
      ).toBe('100');
      expect(snapshot.estimates).not.toEqual(baseline.estimates);
    });

    test.each([
      {
        sql: 'ALTER TABLE podcasts ALTER COLUMN itunes_id TYPE integer',
        kind: 'column',
        category: 'changed',
      },
      {
        sql: 'ALTER TABLE users ALTER COLUMN email DROP NOT NULL',
        kind: 'column',
        category: 'changed',
      },
      {
        sql: "ALTER TABLE users ALTER COLUMN name SET DEFAULT 'synthetic-default'",
        kind: 'column',
        category: 'changed',
      },
      {
        sql: 'ALTER TABLE users ADD COLUMN fixture text',
        kind: 'column',
        category: 'extra',
      },
      {
        sql: 'DROP INDEX idx_episodes_published',
        kind: 'index',
        category: 'missing',
      },
      {
        sql: 'DROP INDEX idx_episodes_published; CREATE INDEX idx_episodes_published ON episodes (published) WHERE id > 0',
        kind: 'index',
        category: 'changed',
      },
      {
        sql: 'ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_podcast_id_fkey',
        kind: 'constraint',
        category: 'missing',
      },
      {
        sql: 'ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_podcast_id_fkey; ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_podcast_id_fkey FOREIGN KEY (podcast_id) REFERENCES podcasts(id) ON DELETE CASCADE NOT VALID',
        kind: 'constraint',
        category: 'changed',
      },
      {
        sql: 'ALTER TABLE users ENABLE ROW LEVEL SECURITY',
        kind: 'relation',
        category: 'changed',
      },
      {
        sql: 'ALTER SEQUENCE authors_id_seq OWNED BY NONE',
        kind: 'sequence',
        category: 'changed',
      },
      {
        sql: 'CREATE TABLE episodes_old (id bigint)',
        kind: 'relation',
        category: 'extra',
      },
    ])('detects $category $kind metadata: $sql', async (change) => {
      await sql.unsafe(change.sql);
      const result = compareSchemas(
        inventoryArtifact(baseline, manifest),
        inventoryArtifact(await captureSchema(sql)),
      );
      expect(result.schemaMatches).toBe(false);
      if (change.category === 'changed')
        expect(
          result.changed.some((row) => JSON.parse(row.key)[0] === change.kind),
        ).toBe(true);
      else if (change.category === 'extra')
        expect(result.extra.some((row) => row.kind === change.kind)).toBe(true);
      else
        expect(result.missing.some((row) => row.kind === change.kind)).toBe(
          true,
        );
      expect(result.adoptionApproved).toBe(false);
    });

    test('reports invalid indexes left by failed concurrent index creation', async () => {
      await sql`INSERT INTO users (id, email, name) VALUES ('a', 'a@example.invalid', 'same'), ('b', 'b@example.invalid', 'same')`;
      await expect(
        sql`CREATE UNIQUE INDEX CONCURRENTLY failed_index ON users(name)`.execute(),
      ).rejects.toThrow();
      const snapshot = await captureSchema(sql);
      expect(
        snapshot.objects.find(
          (row) => row.kind === 'index' && row.name === 'failed_index',
        )?.definition.valid,
      ).toBe(false);
    });

    test('retains exact bigint sequence parameters without advancing the sequence', async () => {
      await sql`ALTER SEQUENCE authors_id_seq AS bigint START WITH 9007199254740993`;
      const snapshot = await captureSchema(sql);
      const sequence = snapshot.objects.find(
        (row) => row.kind === 'sequence' && row.name === 'authors_id_seq',
      );
      expect(sequence?.definition.start).toBe('9007199254740993');
      expect(sequence?.definition.max).toBe('9223372036854775807');
    });

    test('reports access changes separately from schema definitions', async () => {
      await sql`GRANT SELECT ON users TO inventory_reader`;
      const result = compareSchemas(
        inventoryArtifact(baseline, manifest),
        inventoryArtifact(await captureSchema(sql)),
      );
      expect(result.schemaMatches).toBe(true);
      expect(
        result.accessChanges.some((row) => JSON.parse(row.key)[3] === 'users'),
      ).toBe(true);
      expect(result.adoptionApproved).toBe(false);
    });

    test('flags views, routines, custom types, triggers and policies for manual review without executing them', async () => {
      await sql.unsafe(`
      CREATE FUNCTION public.danger() RETURNS text LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'must-not-execute'; END $$;
      CREATE VIEW public.danger_view AS SELECT public.danger() AS value;
      CREATE TYPE public.fixture_enum AS ENUM ('one', 'two');
      CREATE FUNCTION public.fixture_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER fixture BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION public.fixture_trigger();
      CREATE POLICY fixture_policy ON users USING (id = current_user);
    `);
      const snapshot = await captureSchema(sql);
      const result = compareSchemas(
        inventoryArtifact(baseline, manifest),
        inventoryArtifact(snapshot),
      );
      expect(
        result.manualReview.some((key) => JSON.parse(key)[3] === 'danger_view'),
      ).toBe(true);
      for (const kind of ['routine', 'type', 'trigger', 'policy']) {
        expect(
          result.manualReview.some((key) => JSON.parse(key)[0] === kind),
        ).toBe(true);
      }
      expect(stable(snapshot)).not.toContain('must-not-execute');
      expect(result.adoptionApproved).toBe(false);
    });

    test('includes non-public user schemas without confusing pg-prefixed names with system schemas', async () => {
      await sql.unsafe(
        'CREATE SCHEMA pgcustom; CREATE TABLE pgcustom.fixture (id int);',
      );
      try {
        const snapshot = await captureSchema(sql);
        expect(
          snapshot.objects.some(
            (row) => row.schema === 'pgcustom' && row.name === 'fixture',
          ),
        ).toBe(true);
      } finally {
        await sql`DROP SCHEMA pgcustom CASCADE`;
      }
    });

    test('flags default privileges and custom collation/text-search objects', async () => {
      await sql.unsafe(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO inventory_reader;
      CREATE COLLATION public.fixture_collation (provider = libc, locale = 'C');
      CREATE TEXT SEARCH CONFIGURATION public.fixture_search (COPY = pg_catalog.simple);
    `);
      const snapshot = await captureSchema(sql);
      for (const parent of ['default-acl', 'collation', 'text-search-config']) {
        expect(
          snapshot.objects.some(
            (row) => row.parent === parent && row.manualReview,
          ),
        ).toBe(true);
      }
    });

    test('distinguishes operator families with the same name across access methods', async () => {
      await sql.unsafe(
        'CREATE OPERATOR FAMILY public.fixture_family USING btree; CREATE OPERATOR FAMILY public.fixture_family USING hash;',
      );
      const artifact = inventoryArtifact(await captureSchema(sql));
      const families = artifact.inventory.snapshot.objects.filter(
        (row) => row.parent === 'operator-family',
      );
      expect(families).toHaveLength(2);
      expect(families[0].name).not.toBe(families[1].name);
    });

    test('reference ignores remote configuration and CLI emits no raw metadata', () => {
      const root = directory();
      const expected = join(root, 'reference.json');
      const actual = join(root, 'capture.json');
      const output = join(root, 'comparison.json');
      const reference = cli(
        ['reference', '--output', expected],
        'postgres://never-use:private-secret@must-not-connect.invalid/db',
      );
      expect(reference.exitCode).toBe(0);
      const capture = cli(
        ['capture', '--output', actual],
        cluster.url.replace('postgres@', 'inventory_reader@'),
      );
      expect(capture.exitCode).toBe(0);
      const compare = cli([
        'compare',
        '--expected',
        expected,
        '--actual',
        actual,
        '--output',
        output,
      ]);
      expect(compare.exitCode).toBe(0);
      expect(JSON.parse(compare.stdout.toString()).schemaMatches).toBe(true);
      for (const result of [reference, capture, compare]) {
        expect(result.stdout.toString()).not.toContain('private-secret');
        expect(result.stdout.toString()).not.toContain('CREATE TABLE');
        expect(result.stdout.toString()).not.toContain('inventory_reader');
      }
      expect(readProtected(expected).inventory.migrations).toEqual(manifest);
      expect(readProtected(actual).inventory.snapshot.database.role).toBe(
        'inventory_reader',
      );
      expect(readFileSync(actual).byteLength).toBeLessThan(artifactLimit);
    }, 30_000);
  },
);
