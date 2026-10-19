import type { NextRequest } from 'next/server';
import { getSession, getSessionId } from '@/server/auth/session';
import { followState, stateChanges } from '@/server/state';
import { stateResponse } from '@/server/state/http';
import { StateError } from '@/server/state/protocol';
import { getSubscriptions } from '@/server/subscriptions';

export async function GET(request: NextRequest) {
  return stateResponse(async () => {
    const params = request.nextUrl.searchParams;
    const validQuery =
      [...params.keys()].every((key) => key === 'view') &&
      params.getAll('view').length <= 1;
    const view = params.get('view');
    if (validQuery && view === 'membership') {
      const sessionId = await getSessionId();
      if (!sessionId) throw new StateError('unauthenticated', 'Unauthorized');
      return followState.readForSession(sessionId);
    }
    const session = await getSession();
    if (!session) throw new StateError('unauthenticated', 'Unauthorized');
    if (!validQuery)
      throw new StateError('invalid_request', 'Invalid follow query');
    if (view !== null)
      throw new StateError('invalid_request', 'Invalid follow view');
    return getSubscriptions(session.userId);
  });
}

export const POST = (request: Request) => stateChanges.follows(request);

export const DELETE = () =>
  stateResponse(async () => {
    throw new StateError('update_required', 'Use desired-state follow batches');
  });
