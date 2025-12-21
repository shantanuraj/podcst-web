import { NextResponse } from 'next/server';
import { deleteSession } from '@/server/auth/session';

export async function POST() {
  await deleteSession();
  return NextResponse.json({ success: true });
}
