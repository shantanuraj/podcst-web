import type postgres from 'postgres';
import { AuthError } from './error';

export function activeAccount(
  sql: postgres.ISql,
  accountId: string | postgres.Fragment,
) {
  return sql`NOT EXISTS (
    SELECT 1 FROM account_erasure_intents erasure
    WHERE erasure.account_id = ${accountId} AND erasure.action = 'erase_account'
  )`;
}

export function activePasskey(
  sql: postgres.ISql,
  credentialId: string | postgres.Fragment,
) {
  return sql`NOT EXISTS (
    SELECT 1 FROM account_erasure_intents erasure
    WHERE erasure.credential_id = ${credentialId} AND erasure.action = 'revoke_passkey'
  )`;
}

export async function readActiveAccount(
  sql: postgres.ISql,
  accountId: string,
  lock: false | 'share' | 'update' = false,
) {
  const [user] = await sql<{ id: string; email: string }[]>`
    SELECT id, email FROM users WHERE id = ${accountId}
    ${lock === 'update' ? sql`FOR UPDATE` : lock === 'share' ? sql`FOR SHARE` : sql``}
  `;
  if (!user) return null;
  const [active] = await sql`SELECT 1 WHERE ${activeAccount(sql, accountId)}`;
  return active ? user : null;
}

export async function requireActiveAccount(
  sql: postgres.ISql,
  accountId: string,
  lock: 'share' | 'update' = 'share',
) {
  const user = await readActiveAccount(sql, accountId, lock);
  if (!user) throw new AuthError(401, 'Authentication required');
  return user;
}

export async function guardEmailIdentity(sql: postgres.ISql, email: string) {
  const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (user && !(await readActiveAccount(sql, user.id, 'share')))
    throw new AuthError(503, 'Authentication unavailable');
}
