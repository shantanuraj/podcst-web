import { type NextRequest, NextResponse } from 'next/server';
import { verifyCode } from '@/server/auth/email';
import { createSession, generateId } from '@/server/auth/session';
import { sql } from '@/server/db';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, code } = body;

  if (!email || !code) {
    return NextResponse.json(
      { error: 'Email and code required' },
      { status: 400 },
    );
  }

  const verified = await verifyCode(email, code);
  if (!verified) {
    return NextResponse.json(
      { error: 'Invalid or expired code' },
      { status: 400 },
    );
  }

  let [user] = await sql`SELECT id FROM users WHERE email = ${email}`;

  if (!user) {
    const userId = generateId();
    [user] = await sql`
      INSERT INTO users (id, email) VALUES (${userId}, ${email})
      RETURNING id
    `;
  }

  await createSession(user.id);

  return NextResponse.json({ verified: true });
}
