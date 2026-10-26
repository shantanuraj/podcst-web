import type postgres from 'postgres';
import { AuthError } from './error';

export async function requireActiveAccount(
  sql: postgres.ISql,
  accountId: string,
) {
  const [user] =
    await sql`SELECT id, email FROM users WHERE id = ${accountId} FOR KEY SHARE`;
  const [deletion] = await sql`
    SELECT 1 FROM account_erasure_intents
    WHERE account_id = ${accountId} AND action = 'erase_account'
  `;
  if (!user || deletion) throw new AuthError(401, 'Authentication required');
  return user as { id: string; email: string };
}
