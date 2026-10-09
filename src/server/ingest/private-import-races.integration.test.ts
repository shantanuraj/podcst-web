import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { installFeedTransportFixture } from '../../../scripts/fixtures/feed-transport';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { indexPrivatePodcast } from './index-podcast';

installFeedTransportFixture();
const xml =
  '<rss><channel><title>Private</title><description>Fixture</description><item><guid>one</guid><title>One</title><enclosure url="https://example.invalid/audio.mp3" type="audio/mpeg"/></item></channel></rss>';

describe.skipIf(!process.env.PG_BIN)('private import commit fences', () => {
  let cluster: ReturnType<typeof startPostgres>;
  let sql: postgres.Sql;
  let parallel: postgres.Sql;
  let server: ReturnType<typeof Bun.serve>;
  let respond: () => Promise<Response>;
  let generation: string;
  beforeAll(async () => {
    cluster = startPostgres();
    sql = cluster.sql;
    parallel = postgres({ ...cluster.options, max: 3 });
    await createSchemaFixture(sql);
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => respond(),
    });
  }, 30_000);
  afterAll(async () => {
    server?.stop(true);
    await parallel?.end();
    await cluster?.stop();
  });
  beforeEach(async () => {
    await sql`TRUNCATE users, authors RESTART IDENTITY CASCADE`;
    await sql`INSERT INTO users (id, email) VALUES ('owner', 'owner@example.invalid'), ('other', 'other@example.invalid')`;
    await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES ('session', 'owner', now() + interval '1 day')`;
    generation = randomUUID();
    await sql`UPDATE state_generation SET generation = ${generation}`;
    respond = async () => new Response(xml);
  });
  const start = async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    respond = async () => {
      started.resolve();
      await release.promise;
      return new Response(xml);
    };
    const result = indexPrivatePodcast(
      sql,
      server.url.href,
      'owner',
      undefined,
      { generation, sessionId: 'session' },
    );
    await started.promise;
    return { result, release: () => release.resolve() };
  };

  test.each([
    'account',
    'session',
    'generation',
  ])('refuses a private import after %s retirement during fetch', async (kind) => {
    const pending = await start();
    try {
      if (kind === 'account')
        await parallel`DELETE FROM users WHERE id = 'owner'`;
      if (kind === 'session')
        await parallel`DELETE FROM sessions WHERE id = 'session'`;
      if (kind === 'generation')
        await parallel`UPDATE state_generation SET generation = ${randomUUID()}`;
    } finally {
      pending.release();
    }
    await expect(pending.result).rejects.toMatchObject({
      code: kind === 'generation' ? 'recovery_required' : 'unauthenticated',
    });
    expect(await sql`SELECT * FROM podcasts`).toHaveLength(0);
    expect(await sql`SELECT * FROM authors`).toHaveLength(0);
  });

  test('an existing cached identity cannot bypass session or generation checks', async () => {
    const id = await indexPrivatePodcast(sql, server.url.href, 'owner');
    await sql`DELETE FROM sessions WHERE id = 'session'`;
    await expect(
      indexPrivatePodcast(sql, server.url.href, 'owner', undefined, {
        generation,
        sessionId: 'session',
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(
      indexPrivatePodcast(sql, server.url.href, 'owner', undefined, {
        generation: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'recovery_required' });
    expect(await indexPrivatePodcast(sql, server.url.href, 'owner')).toBe(id);
  });

  test('a concurrent private winner is not overwritten or disclosed to the losing owner', async () => {
    const pending = await start();
    try {
      respond = async () => new Response(xml.replace('Private', 'Other owner'));
      await indexPrivatePodcast(parallel, server.url.href, 'other');
    } finally {
      pending.release();
    }
    await expect(pending.result).rejects.toThrow('Feed unavailable');
    const rows = await sql`SELECT owner_user_id, title FROM podcasts`;
    expect([...rows]).toEqual([
      { owner_user_id: 'other', title: 'Other owner' },
    ]);
  });

  test('cancellation during short commit work rolls back metadata and episodes', async () => {
    await sql`CREATE FUNCTION slow_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.1); RETURN NEW; END $$`;
    await sql`CREATE TRIGGER slow_import BEFORE INSERT ON podcasts FOR EACH ROW EXECUTE FUNCTION slow_import()`;
    try {
      const controller = new AbortController();
      respond = async () => {
        setTimeout(() => controller.abort(), 30);
        return new Response(xml);
      };
      await expect(
        indexPrivatePodcast(sql, server.url.href, 'owner', controller.signal),
      ).rejects.toThrow();
      expect(await sql`SELECT * FROM podcasts`).toHaveLength(0);
      expect(await sql`SELECT * FROM authors`).toHaveLength(0);
      expect(await sql`SELECT * FROM episodes`).toHaveLength(0);
    } finally {
      await sql`DROP TRIGGER slow_import ON podcasts`;
      await sql`DROP FUNCTION slow_import()`;
    }
  });
});
