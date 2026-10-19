import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import { NextRequest } from 'next/server';
import postgres from 'postgres';
import type { FollowSnapshot } from '@/shared/state-contract';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { createFollowStateService } from './follows';

const accountId = 'membership-owner';
const generation = '00000000-0000-0000-0000-000000000001';
const first = '9007199254740993';
const second = '9007199254740994';
const hidden = '9223372036854775807';
const followedAtMs = Date.parse('2026-01-02T00:00:00Z');
const populated: FollowSnapshot = {
  protocol: 1,
  accountId,
  generation,
  revision: '9007199254740993',
  items: [
    {
      podcastId: second,
      revision: '9007199254740993',
      followedAtMs,
      availability: 'available',
    },
    {
      podcastId: first,
      revision: '9',
      followedAtMs,
      availability: 'available',
    },
    {
      podcastId: hidden,
      revision: '10',
      followedAtMs: null,
      availability: 'unavailable',
    },
  ],
};

describe.skipIf(!process.env.PG_BIN)(
  'membership reads on isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let follows: ReturnType<typeof createFollowStateService>;
    let route: typeof import('../../app/api/subscriptions/route');
    let cookie: string | undefined;
    let statements: string[];

    beforeAll(async () => {
      cluster = startPostgres();
      sql = postgres({
        ...cluster.options,
        max: 4,
        debug: (_connection, query) => statements?.push(query),
      });
      await createSchemaFixture(sql);
      follows = createFollowStateService(sql);
      mock.module('../db', () => ({ sql }));
      mock.module('next/headers', () => ({
        cookies: async () => ({
          get: (name: string) =>
            name === 'session' && cookie ? { value: cookie } : undefined,
        }),
      }));
      route = await import('../../app/api/subscriptions/route');
    }, 30_000);

    afterAll(async () => {
      mock.restore();
      await sql?.end();
      await cluster?.stop();
    });

    beforeEach(async () => {
      await sql`TRUNCATE users, authors RESTART IDENTITY CASCADE`;
      await sql`UPDATE state_generation SET generation = ${generation}`;
      await sql`
        INSERT INTO users (id, email) VALUES
          (${accountId}, 'membership@example.invalid'),
          ('other', 'other@example.invalid'),
          ('empty', 'empty@example.invalid')
      `;
      await sql`
        INSERT INTO sessions (id, user_id, expires_at) VALUES
          ('owner-session', ${accountId}, now() + interval '1 hour'),
          ('other-session', 'other', now() + interval '1 hour'),
          ('empty-session', 'empty', now() + interval '1 hour'),
          ('expired-session', ${accountId}, now() - interval '1 second'),
          ('revoked-session', ${accountId}, now() + interval '1 hour')
      `;
      await sql`INSERT INTO authors (id, name) VALUES (1, 'Author')`;
      await sql`
        INSERT INTO podcasts (id, author_id, feed_url, title, cover, owner_user_id, episode_count) VALUES
          (${first}, 1, 'https://public.example.invalid/rss', 'Public', '', NULL, 0),
          (${second}, 1, 'https://owned.example.invalid/rss', 'Owned', '', ${accountId}, 0),
          (${hidden}, 1, 'https://hidden.example.invalid/rss', 'Hidden', '', 'other', 0)
      `;
      await sql`
        INSERT INTO subscriptions (user_id, podcast_id, revision, subscribed_at) VALUES
          (${accountId}, ${first}, 9, '2026-01-02'),
          (${accountId}, ${second}, 9007199254740993, '2026-01-02'),
          (${accountId}, ${hidden}, 10, NULL),
          ('other', ${hidden}, 1, NULL)
      `;
      await sql`
        INSERT INTO follow_revision_heads (user_id, revision) VALUES
          (${accountId}, 9007199254740993), ('other', 1)
      `;
      await sql`
        INSERT INTO feed_poll_state (podcast_id, last_success_at)
        SELECT id, now() FROM podcasts
      `;
      cookie = 'owner-session';
      statements = [];
    });

    function request(query = '?view=membership') {
      return route.GET(
        new NextRequest(`http://localhost/api/subscriptions${query}`),
      );
    }

    function expectPrivate(response: Response) {
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('vary')).toBe('Cookie');
    }

    test('reads scope and ordered memberships in one database statement', async () => {
      expect(await follows.read(accountId)).toEqual(populated);
      expect(statements).toHaveLength(1);
    });

    test('authenticates membership and reads its snapshot in one statement', async () => {
      const response = await request();
      expect(response.status).toBe(200);
      expectPrivate(response);
      expect(await response.json()).toEqual(populated);
      expect(statements).toHaveLength(1);
    });

    test('keeps unavailable references and scopes private availability to the session owner', async () => {
      cookie = 'other-session';
      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        protocol: 1,
        accountId: 'other',
        generation,
        revision: '1',
        items: [
          {
            podcastId: hidden,
            revision: '1',
            followedAtMs: null,
            availability: 'available',
          },
        ],
      });
      expect(statements).toHaveLength(1);
    });

    test('returns the account scope for an empty library with no revision head', async () => {
      cookie = 'empty-session';
      const response = await request();
      expect(response.status).toBe(200);
      expectPrivate(response);
      expect(await response.json()).toEqual({
        protocol: 1,
        accountId: 'empty',
        generation,
        revision: '0',
        items: [],
      });
      expect(statements).toHaveLength(1);
    });

    test('rejects absent, invalid, expired, revoked and deleted-account sessions', async () => {
      await sql`DELETE FROM sessions WHERE id = 'revoked-session'`;
      await sql`DELETE FROM users WHERE id = 'empty'`;
      for (const sessionId of [
        undefined,
        'invalid-session',
        'expired-session',
        'revoked-session',
        'empty-session',
      ]) {
        cookie = sessionId;
        statements = [];
        const response = await request();
        expect(response.status).toBe(401);
        expectPrivate(response);
        expect(await response.json()).toEqual({
          code: 'unauthenticated',
          message: 'Unauthorized',
        });
        expect(statements).toHaveLength(sessionId ? 1 : 0);
      }
    });

    test('rechecks session revocation on every membership request', async () => {
      expect((await request()).status).toBe(200);
      await sql`DELETE FROM sessions WHERE id = 'owner-session'`;
      statements = [];
      expect((await request()).status).toBe(401);
      expect(statements).toHaveLength(1);
    });

    test('preserves authentication precedence for malformed queries', async () => {
      for (const query of [
        '?view=membership&extra=1',
        '?view=membership&view=membership',
        '?view=invalid',
        '?view=',
      ]) {
        cookie = 'owner-session';
        let response = await request(query);
        expect(response.status).toBe(400);
        expectPrivate(response);
        expect((await response.json()).code).toBe('invalid_request');
        for (const sessionId of [undefined, 'expired-session']) {
          cookie = sessionId;
          response = await request(query);
          expect(response.status).toBe(401);
          expectPrivate(response);
          expect((await response.json()).code).toBe('unauthenticated');
        }
      }
    });

    test('keeps the default library view and its authentication behavior', async () => {
      const response = await request('');
      expect(response.status).toBe(200);
      expectPrivate(response);
      const body = await response.json();
      expect(body.map(({ id }: { id: string }) => id).sort()).toEqual([
        first,
        second,
      ]);
      expect(
        body.every(
          ({ episodes }: { episodes: unknown[] }) => episodes.length === 0,
        ),
      ).toBe(true);
      expect(statements).toHaveLength(2);
      cookie = 'expired-session';
      expect((await request('')).status).toBe(401);
    });

    test('preserves missing-account and missing-generation errors', async () => {
      await expect(follows.read('missing')).rejects.toMatchObject({
        code: 'unauthenticated',
      });
      await sql`DELETE FROM state_generation`;
      try {
        await expect(follows.read(accountId)).rejects.toMatchObject({
          code: 'unavailable',
        });
        let response = await request();
        expect(response.status).toBe(503);
        expectPrivate(response);
        expect(await response.json()).toEqual({
          code: 'unavailable',
          message: 'State unavailable',
        });
        cookie = 'expired-session';
        response = await request();
        expect(response.status).toBe(401);
        expect((await response.json()).code).toBe('unauthenticated');
      } finally {
        await sql`INSERT INTO state_generation (generation, legacy_generation) VALUES (${generation}, ${generation})`;
      }
    });

    test('validates membership timestamps before returning a snapshot', async () => {
      await sql`UPDATE subscriptions SET subscribed_at = '1969-01-01' WHERE user_id = ${accountId}`;
      const response = await request();
      expect(response.status).toBe(503);
      expectPrivate(response);
      expect((await response.json()).code).toBe('unavailable');
    });

    test('keeps the revision and memberships consistent during concurrent commits', async () => {
      await sql`DELETE FROM subscriptions WHERE user_id = ${accountId}`;
      await sql`UPDATE follow_revision_heads SET revision = 0 WHERE user_id = ${accountId}`;
      await Promise.all([
        (async () => {
          for (let revision = 1; revision <= 12; revision++) {
            await sql.begin(async (tx) => {
              await tx`UPDATE follow_revision_heads SET revision = ${revision} WHERE user_id = ${accountId}`;
              await tx`DELETE FROM subscriptions WHERE user_id = ${accountId}`;
              if (revision % 2)
                await tx`
                  INSERT INTO subscriptions (user_id, podcast_id, revision, subscribed_at)
                  VALUES (${accountId}, ${first}, ${revision}, NULL)
                `;
            });
          }
        })(),
        (async () => {
          for (let read = 0; read < 24; read++) {
            const response = await request();
            expect(response.status).toBe(200);
            const snapshot = (await response.json()) as FollowSnapshot;
            expect(snapshot.items).toEqual(
              Number(snapshot.revision) % 2
                ? [
                    {
                      podcastId: first,
                      revision: snapshot.revision,
                      followedAtMs: null,
                      availability: 'available',
                    },
                  ]
                : [],
            );
          }
        })(),
      ]);
    });
  },
);
