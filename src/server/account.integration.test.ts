import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createSchemaFixture } from '../../scripts/lib/schema-fixture';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `account_test_${randomUUID().replaceAll('-', '')}`;

describe.skipIf(!databaseUrl)('account with PostgreSQL', () => {
  let sql: postgres.Sql;
  let admin: postgres.Sql;
  let account: typeof import('./account');

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL required');
    admin = postgres(databaseUrl, { onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = postgres(databaseUrl, {
      connection: { search_path: schema },
      onnotice: () => {},
    });
    await createSchemaFixture(sql);
    mock.module('./db', () => ({ sql }));
    account = await import('./account');
    await sql`
      INSERT INTO users (id, email, created_at) VALUES
        ('owner', 'owner@example.com', '2024-03-02T10:00:00Z'),
        ('other', 'other@example.com', '2025-01-01T00:00:00Z')
    `;
    await sql`
      INSERT INTO passkeys (id, user_id, credential_id, public_key, aaguid, created_at, last_used_at) VALUES
        ('mac', 'owner', 'c1', '\\x00', 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd', '2024-03-02T10:05:00Z', '2026-10-05T08:00:00Z'),
        ('legacy', 'owner', 'c2', '\\x00', NULL, '2024-04-01T00:00:00Z', NULL),
        ('theirs', 'other', 'c3', '\\x00', NULL, '2025-01-01T00:00:00Z', NULL)
    `;
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
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
