import { cookies } from 'next/headers';
import { sql } from '../db';

const SESSION_COOKIE = 'session';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function generateId(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createSession(userId: string): Promise<string> {
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await sql`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (${sessionId}, ${userId}, ${expiresAt})
  `;

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });

  return sessionId;
}

export async function getSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const [session] = await sql`
    SELECT s.id, s.user_id, s.expires_at, u.email, u.name, u.image
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sessionId} AND s.expires_at > now()
  `;

  if (!session) return null;

  return {
    id: session.id,
    userId: session.user_id,
    email: session.email,
    name: session.name,
    image: session.image,
  };
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;

  if (sessionId) {
    await sql`DELETE FROM sessions WHERE id = ${sessionId}`;
  }

  cookieStore.delete(SESSION_COOKIE);
}
