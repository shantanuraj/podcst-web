import { expect, test } from 'bun:test';
import { stateValidator } from '@/shared/state-contract';
import type { ImportLease } from '../ingest/index-podcast';
import { StateError } from './protocol';
import { createFollowResolutionHandler } from './resolve-response';

const scope = {
  protocol: 1 as const,
  accountId: 'owner',
  generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
};
const request = (body: unknown, headers = { 'X-Podcst-Client': 'native' }) =>
  new Request('https://www.podcst.app/api/subscriptions/resolve', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const input = { ...scope, feedUrls: ['https://example.invalid/feed'] };
const admit = async (signal: AbortSignal): Promise<ImportLease> => ({
  signal,
  assertOwned: async () => {},
  release: async () => {},
});

test('resolution handler binds the authenticated session and preserves retry outcomes', async () => {
  const handler = createFollowResolutionHandler(
    async (account, received, urls, signal, context) => {
      expect(account).toBe('owner');
      expect(received).toEqual(scope);
      expect(urls).toEqual(input.feedUrls);
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(context?.sessionId).toBe('initiating-session');
      expect(context?.admit).toBe(admit);
      return {
        ...scope,
        items: [
          { index: 0, podcastId: null, status: 'retry', retryAfterSeconds: 30 },
        ],
      };
    },
    async () => ({ userId: 'owner', id: 'initiating-session' }),
    () => admit,
  );
  const response = await handler(request(input));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(stateValidator('followResolution')(await response.json())).toBe(true);
});

test('wrong account, invalid body and forbidden context do not resolve or acquire admission', async () => {
  let calls = 0;
  const handler = createFollowResolutionHandler(
    async () => {
      throw new Error('Must not resolve');
    },
    async () => ({ userId: 'owner', id: 'session' }),
    () => {
      calls++;
      return admit;
    },
  );
  for (const [body, status] of [
    [{ ...input, accountId: 'other' }, 409],
    [{ ...input, feedUrls: Array(21).fill('feed') }, 400],
    [{ ...input, protocol: 0 }, 426],
  ] as const) {
    const response = await handler(request(body));
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  }
  expect(
    (await handler(request(input, { 'X-Podcst-Client': '' }))).status,
  ).toBe(403);
  expect(calls).toBe(0);
});

test('revocation and recovery failures are not converted into successful per-item resolution', async () => {
  for (const code of ['unauthenticated', 'recovery_required'] as const) {
    const handler = createFollowResolutionHandler(
      async () => {
        throw new StateError(code, 'Import scope changed');
      },
      async () => ({ userId: 'owner', id: 'session' }),
      () => admit,
    );
    const response = await handler(request(input));
    expect(response.status).toBe(code === 'unauthenticated' ? 401 : 409);
    expect(await response.json()).toEqual({
      code,
      message: 'Import scope changed',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  }
});
