import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import {
  adoptBaseline,
  type BaselineReview,
  inspectBaseline,
  reviewSummary,
} from './baseline-adoption';
import { digest, readProtected, writeProtected } from './lib/artifacts';
import { startPostgres } from './lib/postgres-sandbox';
import { loadMigrations, lockMigrations, migrationStatus } from './migrations';
import {
  captureSchema,
  type InventoryArtifact,
  inventoryArtifact,
} from './schema-catalog';

const baseline = loadMigrations()[0];
const evidence = 'a'.repeat(64);

function cli(args: string[], target = '') {
  return Bun.spawnSync(
    [process.execPath, resolve('scripts/adopt-baseline.ts'), ...args],
    {
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: target,
        DATABASE_URL: 'postgres://must-not-be-used.invalid/app',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
}

function changed(
  review: BaselineReview,
  patch: Partial<BaselineReview['review']>,
) {
  const value = { ...review.review, ...patch };
  return { review: value, digest: digest(value) };
}

describe.skipIf(!process.env.PG_BIN)(
  'reviewed baseline adoption on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let reference: InventoryArtifact;
    let directory: string;

    async function reset(source = baseline.source) {
      await sql.unsafe(
        'DROP SCHEMA IF EXISTS podcst_migrations CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION pg_database_owner; GRANT USAGE ON SCHEMA public TO PUBLIC;',
      );
      await sql.unsafe(source);
    }

    async function runtimeOwnership() {
      const snapshot = await captureSchema(sql);
      for (const object of snapshot.objects.filter(
        (object) => object.kind === 'relation',
      )) {
        await sql.unsafe(
          `ALTER TABLE public."${object.name}" OWNER TO app_runtime`,
        );
      }
      await sql`INSERT INTO users (id, email) VALUES ('synthetic', 'synthetic@example.invalid')`;
    }

    beforeAll(async () => {
      cluster = startPostgres();
      sql = cluster.sql;
      directory = mkdtempSync(join(tmpdir(), 'podcst-adopt-'));
      await sql`CREATE ROLE app_runtime LOGIN`;
      await sql`CREATE ROLE wrong_runtime LOGIN`;
      await reset();
      reference = inventoryArtifact(await captureSchema(sql), [
        { name: baseline.name, checksum: baseline.checksum },
      ]);
    }, 30_000);

    afterAll(async () => {
      await cluster?.stop();
      if (directory) rmSync(directory, { recursive: true, force: true });
    });

    beforeEach(async () => {
      await sql`ALTER ROLE app_runtime NOCREATEROLE`;
      await sql`REVOKE pg_write_all_data FROM app_runtime`;
      await reset();
      await runtimeOwnership();
    });

    test('inspection is read-only, accepts reviewed owner variance and leaves no ledger', async () => {
      const review = await inspectBaseline(
        sql,
        reference,
        'app_runtime',
        evidence,
      );
      expect(reviewSummary(review)).toMatchObject({
        eligible: true,
        adoptionApproved: false,
        runtimeOwnsApplication: true,
      });
      expect(reviewSummary(review).ownerDifferences).toBe(22);
      expect(
        (await sql`SELECT to_regnamespace('podcst_migrations') AS ledger`)[0]
          .ledger,
      ).toBeNull();
      expect(review.review.target.systemId).toMatch(/^\d+$/);
      expect(review.review.target.databaseOid).toMatch(/^\d+$/);
    });

    test('adoption records only baseline, preserves rows and protects history from runtime', async () => {
      const review = await inspectBaseline(
        sql,
        reference,
        'app_runtime',
        evidence,
      );
      const before = Array.from(await sql`SELECT * FROM users`);
      const result = await adoptBaseline(sql, review, review.digest);
      expect(result.applicationTablesChanged).toBe(false);
      expect(Array.from(await sql`SELECT * FROM users`)).toEqual(before);
      expect(
        Array.from(
          await sql`SELECT name, checksum, method, review_digest FROM podcst_migrations.history`,
        ),
      ).toEqual([
        {
          name: baseline.name,
          checksum: baseline.checksum,
          method: 'adopted',
          review_digest: review.digest,
        },
      ]);
      const status = await migrationStatus(sql);
      expect(status.migrations[0].state).toBe('applied');
      expect(
        status.migrations
          .slice(1)
          .every((migration) => migration.state === 'pending'),
      ).toBe(true);
      expect(
        (
          await sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='podcasts' AND column_name='owner_user_id') AS exists`
        )[0].exists,
      ).toBe(false);
      const runtime = postgres({ ...cluster.options, username: 'app_runtime' });
      try {
        expect(
          (await runtime`SELECT count(*)::int AS n FROM public.users`)[0].n,
        ).toBe(1);
        await expect(
          runtime`SELECT * FROM podcst_migrations.history`.execute(),
        ).rejects.toThrow('permission denied');
        await expect(
          runtime`UPDATE podcst_migrations.history SET checksum = ${'b'.repeat(64)}`.execute(),
        ).rejects.toThrow('permission denied');
      } finally {
        await runtime.end();
      }
    });

    test('adopts named-column equivalence without rewriting physical podcast order', async () => {
      await reset(
        baseline.source.replace(
          '  cover TEXT NOT NULL,\n  thumbnail TEXT,',
          '  thumbnail TEXT,\n  cover TEXT NOT NULL,',
        ),
      );
      await runtimeOwnership();
      const review = await inspectBaseline(
        sql,
        reference,
        'app_runtime',
        evidence,
      );
      expect(reviewSummary(review)).toMatchObject({
        eligible: true,
        columnOrderDifferences: 2,
      });
      const before = Array.from(
        await sql`SELECT attname, attnum FROM pg_attribute WHERE attrelid='public.podcasts'::regclass AND attnum > 0 ORDER BY attnum`,
      );
      await adoptBaseline(sql, review, review.digest);
      expect(
        Array.from(
          await sql`SELECT attname, attnum FROM pg_attribute WHERE attrelid='public.podcasts'::regclass AND attnum > 0 ORDER BY attnum`,
        ),
      ).toEqual(before);
    });

    test.each([
      'ALTER TABLE public.users ADD COLUMN unreviewed text',
      'ALTER TABLE public.podcasts ALTER COLUMN title DROP NOT NULL',
      'DROP INDEX public.idx_episodes_published',
      'GRANT SELECT ON public.users TO PUBLIC',
      "CREATE FUNCTION public.unreviewed() RETURNS int LANGUAGE sql AS 'SELECT 1'",
    ])('rejects unsupported starting-state differences: %s', async (statement) => {
      await sql.unsafe(statement);
      const review = await inspectBaseline(
        sql,
        reference,
        'app_runtime',
        evidence,
      );
      expect(reviewSummary(review).eligible).toBe(false);
      await expect(adoptBaseline(sql, review, review.digest)).rejects.toThrow(
        'reconciliation',
      );
      expect(
        (await sql`SELECT to_regnamespace('podcst_migrations') AS ledger`)[0]
          .ledger,
      ).toBeNull();
    });

    test('refuses catalog drift after inspection', async () => {
      const review = await inspectBaseline(
        sql,
        reference,
        'app_runtime',
        evidence,
      );
      await sql`ALTER TABLE public.users ADD COLUMN late_change text`;
      await expect(adoptBaseline(sql, review, review.digest)).rejects.toThrow(
        'catalog changed',
      );
      expect(
        (await sql`SELECT to_regnamespace('podcst_migrations') AS ledger`)[0]
          .ledger,
      ).toBeNull();
    });

    test('ordinary user-data/statistics changes do not authorize or invalidate schema adoption', async () => {
      const review = await inspectBaseline(
        sql,
        reference,
        'app_runtime',
        evidence,
      );
      await sql`INSERT INTO users (id,email) VALUES ('second','second@example.invalid')`;
      await sql`ANALYZE users`;
      await expect(adoptBaseline(sql, review, 'unapproved')).rejects.toThrow(
        'reviewed inspection',
      );
      await adoptBaseline(sql, review, review.digest);
      expect((await sql`SELECT count(*)::int AS n FROM users`)[0].n).toBe(2);
    });

    test('binds the database, operator, recovery evidence and immutable baseline', async () => {
      const review = await inspectBaseline(
        sql,
        reference,
        'app_runtime',
        evidence,
      );
      for (const patch of [
        { target: { ...review.review.target, databaseOid: '0' } },
        { target: { ...review.review.target, systemId: '0' } },
        { target: { ...review.review.target, operatorOid: '0' } },
        { target: { ...review.review.target, operator: 'different' } },
      ]) {
        const altered = changed(review, patch);
        await expect(
          adoptBaseline(sql, altered, altered.digest),
        ).rejects.toThrow('changed');
      }
      const wrongBaseline = changed(review, {
        baseline: {
          name: '0001-private-podcasts.sql',
          checksum: baseline.checksum,
        },
      });
      await expect(
        adoptBaseline(sql, wrongBaseline, wrongBaseline.digest),
      ).rejects.toThrow('baseline');
      await expect(
        inspectBaseline(sql, reference, 'app_runtime', 'missing'),
      ).rejects.toThrow('evidence');
    });

    test('expires stale review and refuses replay without resetting history', async () => {
      const review = await inspectBaseline(
        sql,
        reference,
        'app_runtime',
        evidence,
      );
      const expired = changed(review, { inspectedAt: '2000-01-01T00:00:00Z' });
      await expect(adoptBaseline(sql, expired, expired.digest)).rejects.toThrow(
        'expired',
      );
      await adoptBaseline(sql, review, review.digest);
      await expect(adoptBaseline(sql, review, review.digest)).rejects.toThrow(
        'already exists',
      );
      expect(
        (await sql`SELECT count(*)::int AS n FROM podcst_migrations.history`)[0]
          .n,
      ).toBe(1);
    });

    test('rejects the runtime as operator or a false runtime-role declaration', async () => {
      await expect(
        inspectBaseline(sql, reference, 'postgres', evidence),
      ).rejects.toThrow('isolated');
      const wrong = await inspectBaseline(
        sql,
        reference,
        'wrong_runtime',
        evidence,
      );
      expect(reviewSummary(wrong).runtimeOwnsApplication).toBe(false);
      await expect(adoptBaseline(sql, wrong, wrong.digest)).rejects.toThrow(
        'reconciliation',
      );
      await sql`ALTER ROLE app_runtime CREATEROLE`;
      await expect(
        inspectBaseline(sql, reference, 'app_runtime', evidence),
      ).rejects.toThrow('isolated');
    });

    test('rolls all ledger DDL back if inherited runtime powers defeat revocation', async () => {
      await sql`GRANT pg_write_all_data TO app_runtime`;
      const review = await inspectBaseline(
        sql,
        reference,
        'app_runtime',
        evidence,
      );
      await expect(adoptBaseline(sql, review, review.digest)).rejects.toThrow(
        'Runtime role can access',
      );
      expect(
        (await sql`SELECT to_regnamespace('podcst_migrations') AS ledger`)[0]
          .ledger,
      ).toBeNull();
      expect((await sql`SELECT count(*)::int AS n FROM users`)[0].n).toBe(1);
    });

    test('shares the normal runner lock and refuses concurrent adoption', async () => {
      const review = await inspectBaseline(
        sql,
        reference,
        'app_runtime',
        evidence,
      );
      const other = postgres(cluster.options);
      try {
        await other.begin(async (tx) => {
          await lockMigrations(tx);
          await expect(
            adoptBaseline(sql, review, review.digest),
          ).rejects.toThrow('Another migration runner');
        });
        await adoptBaseline(sql, review, review.digest);
      } finally {
        await other.end();
      }
    });

    test('CLI reference/inspection/application use protected files and never execute later migrations', async () => {
      const expectedPath = join(directory, 'baseline-reference.json');
      const reviewPath = join(directory, 'review.json');
      const receipt = join(directory, 'receipt.json');
      const built = cli(
        ['reference', '--output', expectedPath],
        'not a target',
      );
      expect(built.exitCode).toBe(0);
      expect(readProtected(expectedPath).inventory.migrations).toEqual([
        { name: baseline.name, checksum: baseline.checksum },
      ]);
      const inspected = cli(
        [
          'inspect',
          '--reference',
          expectedPath,
          '--runtime-role',
          'app_runtime',
          '--recovery-evidence',
          evidence,
          '--output',
          reviewPath,
        ],
        cluster.url,
      );
      expect({
        code: inspected.exitCode,
        stderr: inspected.stderr.toString(),
      }).toEqual({ code: 0, stderr: '' });
      const report = JSON.parse(inspected.stdout.toString());
      expect(report.eligible).toBe(true);
      expect(report.adoptionApproved).toBe(false);
      const denied = cli(
        [
          'apply',
          '--review',
          reviewPath,
          '--reviewed',
          'wrong',
          '--receipt',
          receipt,
        ],
        cluster.url,
      );
      expect(denied.exitCode).toBe(1);
      const applied = cli(
        [
          'apply',
          '--review',
          reviewPath,
          '--reviewed',
          report.digest,
          '--receipt',
          receipt,
        ],
        cluster.url,
      );
      expect({
        code: applied.exitCode,
        stderr: applied.stderr.toString(),
      }).toEqual({ code: 0, stderr: '' });
      expect(readProtected(receipt).method).toBe('adopted');
      expect(readProtected(`${receipt}.intent.json`).reviewDigest).toBe(
        report.digest,
      );
      expect(applied.stdout.toString()).not.toContain(cluster.url);
      expect(applied.stdout.toString()).not.toContain('app_runtime');
    }, 30_000);

    test('existing receipt paths fail before database mutation', async () => {
      const review = await inspectBaseline(
        sql,
        reference,
        'app_runtime',
        evidence,
      );
      const path = join(directory, 'blocked-review.json');
      const receipt = join(directory, 'blocked-receipt.json');
      writeProtected(path, review);
      writeProtected(receipt, { keep: true });
      expect(
        cli(
          [
            'apply',
            '--review',
            path,
            '--reviewed',
            review.digest,
            '--receipt',
            receipt,
          ],
          cluster.url,
        ).exitCode,
      ).toBe(1);
      expect(
        (await sql`SELECT to_regnamespace('podcst_migrations') AS ledger`)[0]
          .ledger,
      ).toBeNull();
      expect(readProtected(receipt)).toEqual({ keep: true });
    });
  },
);
