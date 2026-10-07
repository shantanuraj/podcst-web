import { cookies } from 'next/headers';
import { sql } from '../db';
import { insertSession } from './session-record';

export { generateId } from './session-record';

const SESSION_COOKIE = 'session';

export async function setSessionCookie({
  id,
  expiresAt,
}: {
  id: string;
  expiresAt: Date;
}) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });
}

export async function createSession(userId: string): Promise<string> {
  const session = await insertSession(sql, userId);
  await setSessionCookie(session);
  return session.id;
}

export async function getSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const [session] = await sql`
    SELECT
      s.id,
      s.user_id,
      s.expires_at,
      u.email,
      u.name,
      u.image,
      EXISTS(SELECT 1 FROM passkeys p WHERE p.user_id = u.id) as has_passkey
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
    hasPasskey: session.has_passkey,
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
