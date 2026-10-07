import { authResponse } from '@/server/auth/http';
import { getSession } from '@/server/auth/session';

export const GET = () =>
  authResponse(async () => {
    const session = await getSession();
    return {
      user: session
        ? {
            id: session.userId,
            email: session.email,
            name: session.name,
            image: session.image,
            hasPasskey: session.hasPasskey,
          }
        : null,
    };
  });
