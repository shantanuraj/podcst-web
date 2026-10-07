import { authResponse } from '@/server/auth/http';
import { deleteSession } from '@/server/auth/session';

export const POST = () =>
  authResponse(async () => {
    await deleteSession();
    return { success: true };
  });
