import type postgres from 'postgres';
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

async function readAccount(
  userId: string | postgres.PendingQuery<postgres.Row[]>,
): Promise<Account | null> {
  const rows = await sql`
    SELECT u.created_at, p.id AS passkey_id, p.aaguid,
      p.created_at AS passkey_created_at, p.last_used_at,
      ap.speed, ap.volume_boost, ap.trim_silence
    FROM users u
    LEFT JOIN passkeys p ON p.user_id = u.id
    LEFT JOIN account_preferences ap ON ap.user_id = u.id
    WHERE u.id = ${userId}
    ORDER BY p.created_at, p.id
  `;
  const user = rows[0];
  if (!user) return null;

  return {
    createdAt: iso(user.created_at),
    passkeys: rows
      .filter((row) => row.passkey_id !== null)
      .map((passkey) => ({
        id: passkey.passkey_id,
        provider: passkeyProvider(passkey.aaguid),
        createdAt: iso(passkey.passkey_created_at) as string,
        lastUsedAt: iso(passkey.last_used_at),
      })),
    preferences:
      user.speed === null
        ? null
        : {
            speed: user.speed,
            volumeBoost: user.volume_boost,
            trimSilence: user.trim_silence,
          },
  };
}

export async function getAccount(userId: string): Promise<Account> {
  return (
    (await readAccount(userId)) ?? {
      createdAt: null,
      passkeys: [],
      preferences: null,
    }
  );
}

export function getAccountForSession(
  sessionId: string,
): Promise<Account | null> {
  return readAccount(sql`
    (SELECT user_id FROM sessions WHERE id = ${sessionId} AND expires_at > now())
  `);
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
