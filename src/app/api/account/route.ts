import { getAccount } from '@/server/account';
import { AuthError } from '@/server/auth/error';
import { authResponse } from '@/server/auth/http';
import { getSession } from '@/server/auth/session';
import { erasureHandlers } from '@/server/erasure/runtime';

export async function GET() {
  return authResponse(async () => {
    const session = await getSession();
    if (!session) throw new AuthError(401, 'Unauthorized');
    return getAccount(session.userId);
  });
}

export const DELETE = erasureHandlers.erase;
