import { NextResponse } from 'next/server';
import { getSession } from '@/server/auth/session';

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({
    user: {
      id: session.userId,
      email: session.email,
      name: session.name,
      image: session.image,
    },
  });
}
