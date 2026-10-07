import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';

export const generateId = () => randomBytes(20).toString('hex');

export async function insertSession(sql: postgres.ISql, userId: string) {
  const id = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await sql`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (${id}, ${userId}, ${expiresAt})
  `;
  return { id, expiresAt };
}
