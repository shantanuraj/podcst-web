import { permitsMutation } from '@/server/auth/request';
import { getSession } from '@/server/auth/session';
import { sql } from '@/server/db';
import { limitState } from '@/server/state';
import { stateResponse } from '@/server/state/http';
import { readStateBody, StateError } from '@/server/state/protocol';
import {
  createFollowResolver,
  parseFollowResolution,
} from '@/server/state/resolve';

export const maxDuration = 60;
const resolve = createFollowResolver(sql);

export async function POST(request: Request) {
  return stateResponse(async () => {
    if (!permitsMutation(request))
      throw new StateError('request_forbidden', 'Request not permitted');
    const session = await getSession();
    if (!session) throw new StateError('unauthenticated', 'Unauthorized');
    const input = parseFollowResolution(await readStateBody(request));
    if (!input)
      throw new StateError('invalid_request', 'Invalid follow resolution');
    if (input.scope.accountId !== session.userId)
      throw new StateError('account_mismatch', 'Account changed');
    await limitState(session.userId, 'imports');
    return resolve(session.userId, input.scope, input.feedUrls, request.signal);
  });
}
