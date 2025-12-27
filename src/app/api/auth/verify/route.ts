import { type NextRequest, NextResponse } from 'next/server';
import { sendVerificationCode, verifyCode } from '@/server/auth/email';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, code } = body;

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  if (!code) {
    try {
      await sendVerificationCode(email);
      return NextResponse.json({ sent: true });
    } catch (err) {
      console.error('Failed to send verification email:', err);
      return NextResponse.json(
        { error: 'Failed to send verification email' },
        { status: 500 },
      );
    }
  }

  const verified = await verifyCode(email, code);
  if (!verified) {
    return NextResponse.json(
      { error: 'Invalid or expired code' },
      { status: 400 },
    );
  }

  return NextResponse.json({ verified: true });
}
