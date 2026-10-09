import { permitsMutation } from '../auth/request';
import type { PrivateImportScope } from '../ingest/index-podcast';
import { stateResponse } from './http';
import { readStateBody, StateError } from './protocol';
import { type createFollowResolver, parseFollowResolution } from './resolve';

export function createFollowResolutionHandler(
  resolve: ReturnType<typeof createFollowResolver>,
  session: () => Promise<{ userId: string; id: string } | null>,
  admission: (accountId: string) => NonNullable<PrivateImportScope['admit']>,
) {
  return (request: Request) =>
    stateResponse(async () => {
      if (!permitsMutation(request))
        throw new StateError('request_forbidden', 'Request not permitted');
      const user = await session();
      if (!user) throw new StateError('unauthenticated', 'Unauthorized');
      const input = parseFollowResolution(await readStateBody(request));
      if (!input)
        throw new StateError('invalid_request', 'Invalid follow resolution');
      if (input.scope.accountId !== user.userId)
        throw new StateError('account_mismatch', 'Account changed');
      return resolve(user.userId, input.scope, input.feedUrls, request.signal, {
        sessionId: user.id,
        admit: admission(user.userId),
      });
    });
}
