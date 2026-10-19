import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import postgres from 'postgres';
import { startPostgres } from '../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../scripts/lib/schema-fixture';

describe.skipIf(!process.env.PG_BIN)('account with isolated PostgreSQL', () => {
  let cluster: ReturnType<typeof startPostgres>;
  let sql: postgres.Sql;
  let account: typeof import('./account');
  let route: typeof import('../app/api/account/route');
  let sessionRoute: typeof import('../app/api/auth/session/route');
  let cookie: string | undefined;
  let statements: string[] = [];

  beforeAll(async () => {
    cluster = startPostgres();
    sql = postgres({
      ...cluster.options,
      debug: (_connection, query) => statements.push(query),
    });
    await createSchemaFixture(sql);
    mock.module('./db', () => ({ sql }));
    mock.module('next/headers', () => ({
      cookies: async () => ({
        get: (name: string) =>
          name === 'session' && cookie ? { value: cookie } : undefined,
      }),
    }));
    account = await import('./account');
    route = await import('../app/api/account/route');
    sessionRoute = await import('../app/api/auth/session/route');
    await sql`
      INSERT INTO users (id, email, created_at) VALUES
        ('owner', 'owner@example.com', '2024-03-02T10:00:00Z'),
        ('other', 'other@example.com', '2025-01-01T00:00:00Z'),
        ('empty', 'empty@example.com', NULL)
    `;
    await sql`
      INSERT INTO passkeys (id, user_id, credential_id, public_key, aaguid, created_at, last_used_at) VALUES
        ('mac', 'owner', 'c1', '\\x00', 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd', '2024-03-02T10:05:00Z', '2026-10-05T08:00:00Z'),
        ('legacy', 'owner', 'c2', '\\x00', NULL, '2024-04-01T00:00:00Z', NULL),
        ('theirs', 'other', 'c3', '\\x00', NULL, '2025-01-01T00:00:00Z', NULL)
    `;
    await sql`
      INSERT INTO sessions (id, user_id, expires_at) VALUES
        ('owner-session', 'owner', now() + interval '1 hour'),
        ('other-session', 'other', now() + interval '1 hour'),
        ('expired-session', 'owner', now() - interval '1 second'),
        ('revoked-session', 'owner', now() + interval '1 hour')
    `;
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
    await cluster?.stop();
  });

  test('reads the authenticated account in one query with private response headers', async () => {
    cookie = 'owner-session';
    statements = [];
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(await response.json()).toEqual({
      createdAt: '2024-03-02T10:00:00.000Z',
      passkeys: [
        {
          id: 'mac',
          provider: 'iCloud Keychain',
          createdAt: '2024-03-02T10:05:00.000Z',
          lastUsedAt: '2026-10-05T08:00:00.000Z',
        },
        {
          id: 'legacy',
          provider: null,
          createdAt: '2024-04-01T00:00:00.000Z',
          lastUsedAt: null,
        },
      ],
      preferences: null,
    });
    expect(statements).toHaveLength(1);
  });

  test('uses one account query with empty and absent users', async () => {
    for (const userId of ['empty', 'absent']) {
      statements = [];
      expect(await account.getAccount(userId)).toEqual({
        createdAt: null,
        passkeys: [],
        preferences: null,
      });
      expect(statements).toHaveLength(1);
    }
  });

  test('rejects absent, invalid, expired and revoked session cookies', async () => {
    await sql`DELETE FROM sessions WHERE id = 'revoked-session'`;
    for (const sessionId of [
      undefined,
      'invalid-session',
      'expired-session',
      'revoked-session',
    ]) {
      cookie = sessionId;
      statements = [];
      const response = await route.GET();
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ message: 'Unauthorized' });
      expect(statements).toHaveLength(sessionId ? 1 : 0);
    }
  });

  test('scopes account responses to the session owner', async () => {
    cookie = 'other-session';
    statements = [];
    const response = await route.GET();
    expect(await response.json()).toEqual({
      createdAt: '2025-01-01T00:00:00.000Z',
      passkeys: [
        {
          id: 'theirs',
          provider: null,
          createdAt: '2025-01-01T00:00:00.000Z',
          lastUsedAt: null,
        },
      ],
      preferences: null,
    });
    expect(statements).toHaveLength(1);
  });

  test('session reads remain fresh across revocation after cookie helper extraction', async () => {
    cookie = 'revoked-session';
    await sql`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (${cookie}, 'other', now() + interval '1 hour')
    `;
    statements = [];
    const response = await sessionRoute.GET();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(await response.json()).toEqual({
      user: {
        id: 'other',
        email: 'other@example.com',
        name: null,
        image: null,
        hasPasskey: true,
      },
    });
    expect(statements).toHaveLength(1);
    statements = [];
    expect((await route.GET()).status).toBe(200);
    expect(statements).toHaveLength(1);
    await sql`DELETE FROM sessions WHERE id = ${cookie}`;
    statements = [];
    expect(await (await sessionRoute.GET()).json()).toEqual({ user: null });
    expect(statements).toHaveLength(1);
    statements = [];
    expect((await route.GET()).status).toBe(401);
    expect(statements).toHaveLength(1);
  });

  test('reads account details, named passkeys and unsaved preferences', async () => {
    expect(await account.getAccount('owner')).toEqual({
      createdAt: '2024-03-02T10:00:00.000Z',
      passkeys: [
        {
          id: 'mac',
          provider: 'iCloud Keychain',
          createdAt: '2024-03-02T10:05:00.000Z',
          lastUsedAt: '2026-10-05T08:00:00.000Z',
        },
        {
          id: 'legacy',
          provider: null,
          createdAt: '2024-04-01T00:00:00.000Z',
          lastUsedAt: null,
        },
      ],
      preferences: null,
    });
  });

  test('saves preferences per account and replaces them on update', async () => {
    await account.savePreferences('owner', {
      speed: 1.25,
      volumeBoost: true,
      trimSilence: false,
    });
    await account.savePreferences('owner', {
      speed: 0.75,
      volumeBoost: false,
      trimSilence: true,
    });
    expect((await account.getAccount('owner')).preferences).toEqual({
      speed: 0.75,
      volumeBoost: false,
      trimSilence: true,
    });
    expect((await account.getAccount('other')).preferences).toBeNull();
    cookie = 'owner-session';
    statements = [];
    const response = await route.GET();
    expect((await response.json()).preferences).toEqual({
      speed: 0.75,
      volumeBoost: false,
      trimSilence: true,
    });
    expect(statements).toHaveLength(1);
  });

  test('preserves passkey ordering for tied and null creation times', async () => {
    await sql`
      INSERT INTO passkeys (id, user_id, credential_id, public_key, created_at) VALUES
        ('a', 'empty', 'empty-a', '\\x00', '2024-01-01'),
        ('b', 'empty', 'empty-b', '\\x00', '2024-01-01'),
        ('n', 'empty', 'empty-n', '\\x00', NULL)
    `;
    const result = await account.getAccount('empty');
    expect(result.passkeys.map(({ id }) => id)).toEqual(['a', 'b', 'n']);
    expect(result.passkeys[2]).toMatchObject({
      id: 'n',
      provider: null,
      lastUsedAt: null,
    });
    expect(result.passkeys[2].createdAt).toBeNull();
  });

  test('removes only the account’s own passkeys', async () => {
    expect(await account.deletePasskey('owner', 'theirs')).toBe(false);
    expect(await account.deletePasskey('owner', 'legacy')).toBe(true);
    expect(await account.deletePasskey('owner', 'legacy')).toBe(false);
    expect(
      (await account.getAccount('owner')).passkeys.map(({ id }) => id),
    ).toEqual(['mac']);
    expect((await account.getAccount('other')).passkeys).toHaveLength(1);
  });
});
