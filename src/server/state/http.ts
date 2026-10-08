import { stateValidator } from '@/shared/state-contract';
import { privateFeedHeaders as headers } from '../podcast-access';
import { StateError } from './protocol';

export async function stateResponse(operation: () => Promise<unknown>) {
  try {
    return Response.json(await operation(), { headers });
  } catch (error) {
    let failure =
      error instanceof StateError
        ? error
        : new StateError('unavailable', 'State unavailable');
    if (
      !stateValidator('error')({ code: failure.code, message: failure.message })
    )
      failure = new StateError('unavailable', 'State unavailable');
    return Response.json(
      { code: failure.code, message: failure.message },
      {
        status: failure.status,
        headers: {
          ...headers,
          ...(failure.retryAfter
            ? { 'Retry-After': String(failure.retryAfter) }
            : {}),
        },
      },
    );
  }
}
