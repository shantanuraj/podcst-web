import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startPostgres } from './lib/postgres-sandbox';
import { createSchemaFixture } from './lib/schema-fixture';

const script = readFileSync(
  new URL('./podcst-backup.sh', import.meta.url),
  'utf8',
);
const tables = [...script.matchAll(/-t (public\.[a-z_]+)/g)].map(
  (match) => match[1],
);

test('user backup explicitly includes aliases and refuses missing selected tables', () => {
  expect(tables).toContain('public.podcast_feed_aliases');
  expect(tables).toHaveLength(8);
  expect(script).toContain('--strict-names');
});

describe.skipIf(!process.env.PG_BIN)(
  'alias backup on isolated PostgreSQL',
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

    beforeAll(() => {
      cluster = startPostgres();
    }, 30_000);
    beforeEach(async () => {
      await cluster.sql.unsafe(
        'DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
      );
      await createSchemaFixture(cluster.sql);
      await cluster.sql`INSERT INTO authors (id,name) VALUES (1,'Synthetic')`;
      await cluster.sql`INSERT INTO podcasts (id,author_id,title,cover,feed_url) VALUES (1,1,'Synthetic','','https://example.invalid/current')`;
      await cluster.sql`INSERT INTO podcast_feed_aliases (feed_url,podcast_id,evidence_type,evidence_reference) VALUES ('https://example.invalid/previous',1,'reviewed','synthetic-review')`;
    }, 30_000);
    afterAll(async () => {
      await cluster?.stop();
    });

    test('selected dump restores exact alias rows when required parent identity is present', async () => {
      const before = Array.from(
        await cluster.sql`SELECT * FROM podcast_feed_aliases`,
      );
      const result = dump();
      expect({
        code: result.exitCode,
        stderr: result.stderr.toString(),
      }).toEqual({ code: 0, stderr: '' });
      const path = join(cluster.directory, 'aliases.sql');
      const extracted = run('pg_restore', [
        '--data-only',
        '--table=podcast_feed_aliases',
        '--file',
        path,
        join(cluster.directory, 'selected.dump'),
      ]);
      expect(extracted.exitCode).toBe(0);
      await cluster.sql`TRUNCATE podcast_feed_aliases`;
      const restored = run('psql', [
        '-X',
        '-q',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        cluster.directory,
        '-p',
        String(cluster.options.port),
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-f',
        path,
      ]);
      expect({
        code: restored.exitCode,
        stderr: restored.stderr.toString(),
      }).toEqual({ code: 0, stderr: '' });
      expect(
        Array.from(await cluster.sql`SELECT * FROM podcast_feed_aliases`),
      ).toEqual(before);
    });

    test('temporary tables cannot shadow either alias guard', async () => {
      await cluster.sql`INSERT INTO users (id,email) VALUES ('owner','owner@example.invalid')`;
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

    test('missing alias table fails instead of silently producing an incomplete dump', async () => {
      await cluster.sql`DROP TABLE podcast_feed_aliases CASCADE`;
      expect(dump().exitCode).not.toBe(0);
    });
  },
);
