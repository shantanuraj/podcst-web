import { createStore, del, get, update } from 'idb-keyval';
import { responseData } from '@/data/api';
import type { AccountSession } from '@/shared/auth/account-session';
import type { EpisodeList } from '@/shared/lists';
import type { StarRoot } from './state';
import { type StarStorage, StarSync } from './sync';

export function browserStorage(): StarStorage {
  const store = createStore('podcst-lists', 'state');
  return {
    load: async () => (await get<StarRoot>('root', store)) ?? {},
    update: async (change) => {
      let result: StarRoot = {};
      await update<StarRoot>(
        'root',
        (stored) => {
          result = stored ?? {};
          change(result);
          return result;
        },
        store,
      );
      return result;
    },
  };
}

const runtimes = new WeakMap<
  AccountSession,
  { sync: StarSync; notify: () => void }
>();
export function starRuntime(session: AccountSession) {
  const runtime = runtimes.get(session);
  if (runtime) return runtime;
  const request = <T>(path: string, body?: unknown) =>
    session.run(session.token(), 'episode-lists', async (signal) =>
      responseData<T>(
        await fetch(`/api/lists${path}`, {
          method: body ? 'POST' : 'GET',
          cache: 'no-store',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        }),
      ),
    );
  const created = {
    notify: () => {},
    sync: new StarSync(
      browserStorage(),
      {
        lists: async () => {
          const token = session.token();
          const confirm = async () => {
            const result = await session.run(
              token,
              'episode-lists',
              async (signal) =>
                responseData<{ user: { id: string } | null }>(
                  await fetch('/api/auth/session', {
                    cache: 'no-store',
                    signal: AbortSignal.any([
                      signal,
                      AbortSignal.timeout(15_000),
                    ]),
                  }),
                ),
            );
            if (result.user?.id !== token.scope) {
              session.externalChange();
              throw new Error('Session changed');
            }
          };
          await confirm();
          const result = await request<{ lists: EpisodeList[] }>('');
          await confirm();
          return result.lists;
        },
        membership: (id) => request(`/${id}/items?view=membership`),
        changes: (id, batch) => request(`/${id}/changes`, batch),
        episodes: (id, cursor) =>
          request(
            `/${id}/items?view=episodes${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          ),
      },
      async (work) => {
        if (!navigator.locks)
          throw new Error('Cross-tab synchronization is unavailable');
        await navigator.locks.request(
          'podcst-list-sender',
          { ifAvailable: true },
          async (lock) => {
            if (lock) await work();
          },
        );
      },
      () => created.notify(),
    ),
  };
  runtimes.set(session, created);
  return created;
}

export function connectStars(session: AccountSession) {
  const runtime = starRuntime(session);
  const channel = new BroadcastChannel('podcst-lists');
  runtime.notify = () => channel.postMessage('changed');
  channel.onmessage = () => {
    void runtime.sync.reload();
  };
  let revision = -1;
  let ready = false;
  const activate = () => {
    const next = session.getSnapshot();
    if (revision === next.revision && ready === next.ready) return;
    revision = next.revision;
    ready = next.ready;
    void runtime.sync.activate(ready ? session.scope : undefined);
  };
  const unsubscribe = session.subscribe(activate);
  activate();
  void del('stars').catch(() => {});
  const refresh = () => {
    if (document.visibilityState === 'visible') void runtime.sync.refresh();
  };
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  let ticks = 0;
  const timer = setInterval(() => {
    const state = runtime.sync.getSnapshot().state;
    if (
      state?.flight ||
      state?.queued.length ||
      (++ticks % 12 === 0 && location.pathname.includes('/library'))
    )
      refresh();
  }, 5000);
  return () => {
    unsubscribe();
    clearInterval(timer);
    window.removeEventListener('online', refresh);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
    runtime.notify = () => {};
    channel.close();
    void runtime.sync.activate(undefined);
  };
}
