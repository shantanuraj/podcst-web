import { expect, mock, test } from 'bun:test';
import {
  type FollowAcknowledgement,
  type ProgressAcknowledgement,
  stateValidator,
} from '@/shared/state-contract';
import fixtures from '../../../contracts/state/fixtures.json';
import { StateError } from './protocol';
import { createStateChangeHandlers } from './response';

function fixture(accountId: string | null = fixtures.progressBatch.accountId) {
  const service = {
    progress: mock(
      async () =>
        structuredClone(
          fixtures.progressAcknowledgement,
        ) as ProgressAcknowledgement,
    ),
    follows: mock(
      async () =>
        structuredClone(
          fixtures.followAcknowledgement,
        ) as FollowAcknowledgement,
    ),
  };
  const limit = mock(async () => {});
  const handlers = createStateChangeHandlers(
    service,
    async () => accountId,
    limit,
  );
  return { service, limit, handlers };
}

const request = (body: unknown) =>
  new Request('https://example.invalid/api/progress', {
    method: 'PUT',
    headers: {
      'X-Podcst-Client': 'native',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

async function checkError(response: Response, code: string, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.headers.get('Vary')).toBe('Cookie');
  const body = await response.json();
  expect(stateValidator('error')(body)).toBe(true);
  expect(body.code).toBe(code);
}

test('validates actual handler response bodies against the state schemas', async () => {
  const { handlers, service, limit } = fixture();
  const progress = await handlers.progress(request(fixtures.progressBatch));
  const follows = await handlers.follows(request(fixtures.followBatch));
  expect(progress.status).toBe(200);
  expect(follows.status).toBe(200);
  expect(stateValidator('progressAcknowledgement')(await progress.json())).toBe(
    true,
  );
  expect(stateValidator('followAcknowledgement')(await follows.json())).toBe(
    true,
  );
  expect(progress.headers.get('Cache-Control')).toBe('private, no-store');
  expect(follows.headers.get('Vary')).toBe('Cookie');
  expect(service.progress).toHaveBeenCalledWith(
    fixtures.progressBatch.accountId,
    fixtures.progressBatch,
  );
  expect(service.follows).toHaveBeenCalledWith(
    fixtures.followBatch.accountId,
    fixtures.followBatch,
  );
  expect(limit).toHaveBeenCalledTimes(2);
});

test('rejects missing auth before reading inputs or calling limits and services', async () => {
  const { handlers, service, limit } = fixture(null);
  await checkError(
    await handlers.progress(request(null)),
    'unauthenticated',
    401,
  );
  await checkError(
    await handlers.follows(request(null)),
    'unauthenticated',
    401,
  );
  expect(limit).not.toHaveBeenCalled();
  expect(service.progress).not.toHaveBeenCalled();
  expect(service.follows).not.toHaveBeenCalled();
});

test('fences the expected account without treating it as authority', async () => {
  const { handlers, service, limit } = fixture('fixture-account-b');
  await checkError(
    await handlers.progress(request(fixtures.progressBatch)),
    'account_mismatch',
    409,
  );
  await checkError(
    await handlers.follows(request(fixtures.followBatch)),
    'account_mismatch',
    409,
  );
  expect(limit).not.toHaveBeenCalled();
  expect(service.progress).not.toHaveBeenCalled();
  expect(service.follows).not.toHaveBeenCalled();
});

test('rejects cross-origin mutations and obsolete protocol versions', async () => {
  const { handlers, service } = fixture();
  const crossOrigin = request(fixtures.progressBatch);
  crossOrigin.headers.set('Origin', 'https://foreign.example.invalid');
  await checkError(
    await handlers.progress(crossOrigin),
    'request_forbidden',
    403,
  );
  await checkError(
    await handlers.progress(
      request({ ...fixtures.progressBatch, protocol: 2 }),
    ),
    'update_required',
    426,
  );
  expect(service.progress).not.toHaveBeenCalled();
});

test('returns schema-checked bounded errors without exposing backend details', async () => {
  const { handlers, service, limit } = fixture();
  service.progress.mockImplementation(async () => {
    throw new Error('private database detail');
  });
  await checkError(
    await handlers.progress(request(fixtures.progressBatch)),
    'unavailable',
    503,
  );
  service.follows.mockImplementation(async () => {
    throw new StateError('sequence_conflict', 'State stream is blocked');
  });
  await checkError(
    await handlers.follows(request(fixtures.followBatch)),
    'sequence_conflict',
    409,
  );
  limit.mockImplementation(async () => {
    throw new StateError('rate_limited', 'State rate limit reached', 60);
  });
  const response = await handlers.progress(request(fixtures.progressBatch));
  expect(response.headers.get('Retry-After')).toBe('60');
  await checkError(response, 'rate_limited', 429);
});

test('refuses malformed or misbound acknowledgements instead of discarding client intent', async () => {
  for (const change of [
    { accountId: 'fixture-account-b' },
    { sequence: '2' },
    { generation: '00000000-0000-0000-0000-000000000000' },
    { clientId: '00000000-0000-0000-0000-000000000000' },
    { revision: '9223372036854775808' },
    { results: [] },
    { results: [...fixtures.progressAcknowledgement.results].reverse() },
    { extra: true },
  ]) {
    const { handlers, service } = fixture();
    service.progress.mockImplementation(
      async () =>
        ({
          ...fixtures.progressAcknowledgement,
          ...change,
        }) as ProgressAcknowledgement,
    );
    await checkError(
      await handlers.progress(request(fixtures.progressBatch)),
      'unavailable',
      503,
    );
  }
});
