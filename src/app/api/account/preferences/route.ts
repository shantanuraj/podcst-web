import type { NextRequest } from 'next/server';
import { savePreferences } from '@/server/account';
import { AuthError } from '@/server/auth/error';
import { authResponse, readAuthBody } from '@/server/auth/http';
import { getSession } from '@/server/auth/session';
import { parsePreferences } from '@/shared/preferences';

export async function PUT(request: NextRequest) {
  return authResponse(async () => {
    const session = await getSession();
    if (!session) throw new AuthError(401, 'Unauthorized');
    const preferences = parsePreferences(await readAuthBody(request));
    if (!preferences)
      throw new AuthError(400, 'speed, volumeBoost and trimSilence required');
    await savePreferences(session.userId, preferences);
    return preferences;
  });
}
