import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import postgres from 'postgres';
import { stateValidator } from '../src/shared/state-contract';

const base = process.env.STATE_TEST_BASE_URL;
const socket = process.env.STATE_TEST_SOCKET;
const port = Number(process.env.STATE_TEST_PORT);
const configured = [base, socket, process.env.STATE_TEST_PORT].some(
  (value) => value !== undefined,
);

describe.skipIf(!configured)(
  'built application durable-state HTTP contract',
  () => {
    let sql: postgres.Sql;
    const accountId = 'transport-owner';
    const cookie = randomBytes(20).toString('hex');
    const otherCookie = randomBytes(20).toString('hex');
    const episodeId = '282272719';
    const podcastId = '1';

    beforeAll(async () => {
      if (!base || !socket)
        throw new Error('Isolated application target required');
      const target = new URL(base);
      expect(target.protocol).toBe('http:');
      expect(target.hostname).toBe('127.0.0.1');
      expect(
        target.username + target.password + target.search + target.hash,
      ).toBe('');
      expect(target.pathname).toBe('/');
      const directory = realpathSync(socket);
      expect(dirname(directory)).toBe(realpathSync(tmpdir()));
      expect(basename(directory).startsWith('podcst-pg-')).toBe(true);
      const uid = process.getuid?.();
      if (uid === undefined)
        throw new Error('An owner-checked POSIX sandbox is required');
      expect(lstatSync(directory).uid).toBe(uid);
      expect(lstatSync(directory).mode & 0o077).toBe(0);
      expect(Number.isInteger(port) && port > 0 && port < 65536).toBe(true);
      sql = postgres({
        host: directory,
        port,
        username: 'postgres',
        database: 'postgres',
        max: 1,
      });
      expect(
        realpathSync((await sql`SHOW data_directory`)[0].data_directory),
      ).toBe(realpathSync(join(directory, 'data')));
      await sql`INSERT INTO users (id, email) VALUES (${accountId}, 'transport-owner@example.invalid'), ('transport-other', 'transport-other@example.invalid')`;
      await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES (${cookie}, ${accountId}, now() + interval '1 hour'), (${otherCookie}, 'transport-other', now() + interval '1 hour')`;
      await sql`INSERT INTO passkeys (id, user_id, credential_id, public_key) VALUES
        ('transport-own-key', ${accountId}, 'transport-own-credential', decode('12', 'hex')),
        ('transport-other-key', 'transport-other', 'transport-other-credential', decode('34', 'hex'))`;
      await sql`INSERT INTO podcasts (id, author_id, feed_url, title, cover, owner_user_id)
        VALUES (990003, 1, 'https://example.invalid/transport-private.xml', 'Private synthetic podcast', '', ${accountId})`;
    });
    afterAll(async () => {
      await sql?.end();
    });

    async function request(
      path: string,
      method = 'GET',
      body?: unknown,
      token = cookie,
      expectedStatus = 200,
    ) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Podcst-Client': 'native',
          Cookie: `session=${token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Vary')).toContain('Cookie');
      return { status: response.status, body: await response.json() };
    }

    test('serves accounts without access to dormant erasure or migration bookkeeping', async () => {
      expect(
        Array.from(
          await sql`SELECT checksum FROM podcst_migrations.history WHERE name = '0013-account-erasure.sql'`,
        ),
      ).toEqual([
        {
          checksum:
            '0a0d3cd65e6369267f16085f37c1389029fae10db99abce8933c6445c03a2733',
        },
      ]);
      expect(
        (await sql`SELECT to_regclass('public.recovery_state') AS relation`)[0]
          .relation,
      ).toBeNull();
      expect(
        Array.from(
          await sql`SELECT rolsuper, rolinherit FROM pg_roles WHERE rolname = 'web_runtime'`,
        ),
      ).toEqual([{ rolsuper: false, rolinherit: false }]);
      for (const table of ['account_erasure_intents', 'account_erasure_proofs'])
        expect(
          (
            await sql`SELECT has_table_privilege('web_runtime', ${`public.${table}`}, 'SELECT,INSERT,UPDATE,DELETE') AS permitted`
          )[0].permitted,
        ).toBe(false);
      expect(
        (
          await sql`SELECT has_schema_privilege('web_runtime', 'podcst_migrations', 'USAGE') AS permitted`
        )[0].permitted,
      ).toBe(false);
      expect((await request('/api/auth/session')).body.user.id).toBe(accountId);
      expect((await request('/api/account')).body.passkeys).toHaveLength(1);
      const preferences = {
        speed: 1.25,
        volumeBoost: true,
        trimSilence: false,
      };
      await request('/api/account/preferences', 'PUT', preferences);
      expect((await request('/api/account')).body.preferences).toEqual(
        preferences,
      );
      expect(
        (
          await sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename = 'web_runtime'`
        )[0].count,
      ).toBeGreaterThan(0);
    });

    test('removes only the authenticated account passkey without a journal', async () => {
      const path = '/api/account/passkeys/transport-own-key';
      await request(path, 'DELETE', undefined, 'missing-session', 401);
      await request(
        '/api/account/passkeys/transport-other-key',
        'DELETE',
        undefined,
        cookie,
        404,
      );
      expect((await request(path, 'DELETE')).body).toEqual({ success: true });
      await request(path, 'DELETE', undefined, cookie, 404);
      expect((await request('/api/account')).body.passkeys).toEqual([]);
      expect(
        (await request('/api/account', 'GET', undefined, otherCookie)).body
          .passkeys,
      ).toHaveLength(1);
      expect((await request('/api/auth/session')).body.user.hasPasskey).toBe(
        false,
      );
    });

    test('keeps private feeds owner-scoped without recovery infrastructure', async () => {
      const path = '/api/feed?id=990003';
      await request(path);
      await request(path, 'GET', undefined, otherCookie, 404);
      await request(path, 'GET', undefined, 'missing-session', 404);
    });

    test('does not expose account deletion routes', async () => {
      for (const [path, method] of [
        ['/api/account', 'DELETE'],
        ['/api/account/deletion', 'POST'],
        ['/api/account/deletion/status', 'POST'],
      ]) {
        const response = await fetch(`${base}${path}`, {
          method,
          headers: { 'X-Podcst-Client': 'native', Cookie: `session=${cookie}` },
          signal: AbortSignal.timeout(15_000),
          redirect: 'error',
        });
        expect([404, 405]).toContain(response.status);
        await response.body?.cancel();
      }
      expect((await request('/api/auth/session')).body.user.id).toBe(accountId);
    });

    test('preserves intent through actual authenticated routes and refuses obsolete/wrong-account writers', async () => {
      const initial = await request('/api/progress?view=state&recent=1');
      expect(initial.status).toBe(200);
      expect(initial.body.accountId).toBe(accountId);
      expect(stateValidator('progressSnapshot')(initial.body)).toBe(true);
      const scope = {
        protocol: 1,
        accountId,
        generation: initial.body.generation,
      };
      const a = randomUUID();
      const b = randomUUID();
      const progress = (
        clientId: string,
        sequence: string,
        positionSeconds: number,
        completed: boolean | null,
      ) => ({
        ...scope,
        clientId,
        sequence,
        changes: [{ episodeId, positionSeconds, completed }],
      });
      expect(
        (await request('/api/progress', 'PUT', progress(a, '1', 90, false)))
          .status,
      ).toBe(200);
      expect(
        (await request('/api/progress', 'PUT', progress(b, '1', 0, true)))
          .status,
      ).toBe(200);
      const checkpoint = progress(a, '2', 95, null);
      const acknowledged = await request('/api/progress', 'PUT', checkpoint);
      expect(stateValidator('progressAcknowledgement')(acknowledged.body)).toBe(
        true,
      );
      const played = await request(
        `/api/progress?view=state&episodeIds=${episodeId}`,
      );
      expect(played.body.items[0].progress).toMatchObject({
        positionSeconds: 95,
        completed: true,
      });
      await request('/api/progress', 'PUT', progress(b, '2', 0, false));
      expect((await request('/api/progress', 'PUT', checkpoint)).body).toEqual(
        acknowledged.body,
      );
      expect(
        (await request(`/api/progress?view=state&episodeIds=${episodeId}`)).body
          .items[0].progress,
      ).toMatchObject({ positionSeconds: 0, completed: false });

      const follow = (clientId: string, followed: boolean) => ({
        ...scope,
        clientId,
        sequence: '1',
        changes: [{ podcastId, followed }],
      });
      const followed = await request(
        '/api/subscriptions',
        'POST',
        follow(a, true),
      );
      expect(stateValidator('followAcknowledgement')(followed.body)).toBe(true);
      await request('/api/subscriptions', 'POST', follow(b, false));
      expect(
        (await request('/api/subscriptions', 'POST', follow(a, true))).body,
      ).toEqual(followed.body);
      const membership = await request('/api/subscriptions?view=membership');
      expect(stateValidator('followSnapshot')(membership.body)).toBe(true);
      expect(membership.body.items).toEqual([]);

      const collection = await request('/api/lists');
      expect(collection.body.accountId).toBe(accountId);
      expect(collection.body.generation).toBe(scope.generation);
      const listId = collection.body.lists[0].id;
      const change = (clientId: string, sequence: string, op: string) => ({
        ...scope,
        clientId,
        sequence,
        changes: [{ op, episodeId }],
      });
      const starred = await request(
        `/api/lists/${listId}/changes`,
        'POST',
        change(a, '1', 'add'),
      );
      expect(starred.status).toBe(200);
      await request(
        `/api/lists/${listId}/changes`,
        'POST',
        change(b, '1', 'remove'),
      );
      expect(
        (
          await request(
            `/api/lists/${listId}/changes`,
            'POST',
            change(a, '1', 'add'),
          )
        ).body,
      ).toEqual(starred.body);
      expect(
        (await request(`/api/lists/${listId}/items?view=membership`)).body
          .items,
      ).toEqual([]);
      const legacy = {
        clientId: randomUUID(),
        sequence: '1',
        changes: [{ op: 'add', episodeId: Number(episodeId) }],
      };
      const migrated = await request(`/api/lists/${listId}/migration`, 'POST', {
        ...scope,
        batch: legacy,
      });
      expect(migrated.body.results[0].episodeId).toBe(episodeId);
      await request(
        `/api/lists/${listId}/changes`,
        'POST',
        change(b, '2', 'remove'),
      );
      expect(
        (
          await request(`/api/lists/${listId}/migration`, 'POST', {
            ...scope,
            batch: legacy,
          })
        ).body,
      ).toEqual(migrated.body);
      expect(
        (await request(`/api/lists/${listId}/items?view=membership`)).body
          .items,
      ).toEqual([]);

      expect(
        (
          await request(
            '/api/progress',
            'PUT',
            progress(a, '3', 10, null),
            otherCookie,
            409,
          )
        ).body.code,
      ).toBe('account_mismatch');
      expect(
        (
          await request(
            '/api/progress',
            'PUT',
            { episodeId, position: 12 },
            cookie,
            426,
          )
        ).status,
      ).toBe(426);
      expect(
        (await request('/api/subscriptions', 'DELETE', undefined, cookie, 426))
          .status,
      ).toBe(426);
      expect(
        (
          await request(
            '/api/progress',
            'PUT',
            progress(a, '3', -1, false),
            cookie,
            400,
          )
        ).status,
      ).toBe(400);
      await sql`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = ${cookie}`;
      expect(
        (
          await request(
            '/api/progress',
            'PUT',
            progress(a, '3', 10, null),
            cookie,
            401,
          )
        ).status,
      ).toBe(401);
    }, 30_000);
  },
);
