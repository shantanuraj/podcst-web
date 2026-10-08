import { afterEach, expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { AccountUser } from '@/shared/auth/account';
import { AccountSession } from '@/shared/auth/account-session';
import type { EpisodeChapters } from '@/shared/chapters';
import type { IEpisodeInfo } from '@/types';
import { chapterQueryOptions } from './chapters';

const episode = {
  id: '42',
  podcastId: '7',
  isPrivate: true,
  file: { url: 'https://example.invalid/secret' },
} as IEpisodeInfo;
const owner: AccountUser = {
  id: 'owner',
  email: 'owner@example.invalid',
  name: null,
  image: null,
  hasPasskey: false,
};
const result: EpisodeChapters = {
  source: 'embedded',
  chapters: [
    { title: 'Opening', start: 0 },
    { title: 'Topic', start: 10 },
  ],
};
const clients: QueryClient[] = [];
const spies: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>[] = [];

function fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  clients.push(client);
  const identity: { user: AccountUser | null } = { user: owner };
  const session = new AccountSession(client, owner, {
    resetPlayer() {},
    reload() {},
    publish() {},
    readSession: async () => identity.user,
  });
  return { client, session, identity };
}

function respondWith(
  operation: (...args: Parameters<typeof fetch>) => Promise<Response>,
) {
  return spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(operation, { preconnect() {} }),
  );
}

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  for (const client of clients.splice(0)) client.clear();
});

test('requests by database ID, scopes keys by account and revision, and disables guest private requests', async () => {
  const { client, session } = fixture();
  const spy = spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json(result),
  );
  spies.push(spy);
  const options = chapterQueryOptions(session, episode);
  expect(options.queryKey).toEqual(['account', 'owner', 'chapters', '42', 0]);
  expect(JSON.stringify(options.queryKey)).not.toContain('secret');
  expect(await client.fetchQuery<EpisodeChapters>(options)).toEqual(result);
  expect(spy.mock.calls[0][0]).toBe('/api/episodes/42/chapters');
  expect(spy.mock.calls[0][1]?.cache).toBe('no-store');
  expect(
    chapterQueryOptions(session, { ...episode, id: undefined }).enabled,
  ).toBe(false);
  const guest = new AccountSession(client, null, {
    resetPlayer() {},
    reload() {},
    publish() {},
  });
  expect(chapterQueryOptions(guest, episode).enabled).toBe(false);
  expect(
    chapterQueryOptions(guest, { ...episode, isPrivate: false }).enabled,
  ).toBe(true);
});

for (const next of [null, { ...owner, id: 'other' }]) {
  test(`rejects stale responses after switching to ${next?.id ?? 'guest'}, even when fetch ignores abort`, async () => {
    const { client, session, identity } = fixture();
    let finish: (response: Response) => void = () => {};
    let signal: AbortSignal | null | undefined;
    spies.push(
      respondWith((_, init) => {
        signal = init?.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }),
    );
    const options = chapterQueryOptions(session, episode);
    const request = client.fetchQuery(options).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.beginAuthChange();
    identity.user = next;
    await session.refresh();
    expect(signal?.aborted).toBe(true);
    finish(Response.json(result));
    expect(await request).toBeNull();
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
    expect(chapterQueryOptions(session, episode).queryKey).not.toEqual(
      options.queryKey,
    );
  });
}

test('changing episodes cancels and discards the old observer response', async () => {
  const { client, session } = fixture();
  let finish: (response: Response) => void = () => {};
  let oldSignal: AbortSignal | null | undefined;
  spies.push(
    respondWith((input, init) => {
      if (String(input).includes('/42/')) {
        oldSignal = init?.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return Promise.resolve(
        Response.json({
          ...result,
          chapters: result.chapters.map((chapter) => ({
            ...chapter,
            title: 'New episode',
          })),
        }),
      );
    }),
  );
  const observer = new QueryObserver(
    client,
    chapterQueryOptions(session, episode),
  );
  const unsubscribe = observer.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  observer.setOptions(chapterQueryOptions(session, { ...episode, id: '43' }));
  await observer.refetch();
  expect(oldSignal?.aborted).toBe(true);
  finish(Response.json(result));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(observer.getCurrentResult().data?.chapters[0].title).toBe(
    'New episode',
  );
  unsubscribe();
  observer.destroy();
});

test('authorization denial invalidates the podcast, not an unrelated episode-number resource', async () => {
  const { client, session } = fixture();
  spies.push(
    spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ message: 'Episode not found' }, { status: 404 }),
    ),
  );
  await expect(
    client.fetchQuery(chapterQueryOptions(session, episode)),
  ).rejects.toThrow();
  await session.refresh();
  expect(session.getSnapshot().denied.has('7')).toBe(true);
  expect(chapterQueryOptions(session, episode).enabled).toBe(false);
});
