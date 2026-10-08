import type { NextRequest } from 'next/server';
import { getSession } from '@/server/auth/session';
import { followState, stateChanges } from '@/server/state';
import { stateResponse } from '@/server/state/http';
import { StateError } from '@/server/state/protocol';
import { getSubscriptions } from '@/server/subscriptions';

export async function GET(request: NextRequest) {
  return stateResponse(async () => {
    const session = await getSession();
    if (!session) throw new StateError('unauthenticated', 'Unauthorized');
    const params = request.nextUrl.searchParams;
    if (
      [...params.keys()].some((key) => key !== 'view') ||
      params.getAll('view').length > 1
    )
      throw new StateError('invalid_request', 'Invalid follow query');
    const view = params.get('view');
    if (view === 'membership') return followState.read(session.userId);
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
