import type { Preferences } from '@/shared/preferences';
import { passkeyProvider } from './auth/passkey-providers';
import { sql } from './db';

export interface AccountPasskey {
  id: string;
  provider: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface Account {
  createdAt: string | null;
  passkeys: AccountPasskey[];
  preferences: Preferences | null;
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export async function getAccount(userId: string): Promise<Account> {
  const [[user], passkeys, [preferences]] = await Promise.all([
    sql`SELECT created_at FROM users WHERE id = ${userId}`,
    sql`
      SELECT id, aaguid, created_at, last_used_at
      FROM passkeys
      WHERE user_id = ${userId}
      ORDER BY created_at, id
    `,
    sql`
      SELECT speed, volume_boost, trim_silence
      FROM account_preferences
      WHERE user_id = ${userId}
    `,
  ]);
  return {
    createdAt: iso(user?.created_at ?? null),
    passkeys: passkeys.map((passkey) => ({
      id: passkey.id,
      provider: passkeyProvider(passkey.aaguid),
      createdAt: iso(passkey.created_at) as string,
      lastUsedAt: iso(passkey.last_used_at),
    })),
    preferences: preferences
      ? {
          speed: preferences.speed,
          volumeBoost: preferences.volume_boost,
          trimSilence: preferences.trim_silence,
        }
      : null,
  };
}

export async function savePreferences(
  userId: string,
  preferences: Preferences,
) {
  await sql`
    INSERT INTO account_preferences (user_id, speed, volume_boost, trim_silence)
    VALUES (
      ${userId},
      ${preferences.speed},
      ${preferences.volumeBoost},
      ${preferences.trimSilence}
    )
    ON CONFLICT (user_id) DO UPDATE SET
      speed = EXCLUDED.speed,
      volume_boost = EXCLUDED.volume_boost,
      trim_silence = EXCLUDED.trim_silence,
      updated_at = now()
  `;
}

export async function deletePasskey(userId: string, passkeyId: string) {
  const removed = await sql`
    DELETE FROM passkeys WHERE user_id = ${userId} AND id = ${passkeyId}
    RETURNING id
  `;
  return removed.length > 0;
}
