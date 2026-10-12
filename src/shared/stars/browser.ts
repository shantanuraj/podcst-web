import { createStore, get, update } from 'idb-keyval';
import { responseData } from '@/data/api';
import type { AccountSession } from '@/shared/auth/account-session';
import type { ListsSnapshot } from '@/shared/lists';
import { durableStorage } from '@/shared/storage/durable';
import { convertStars } from './conversion';
import { type StarRoot, validStarScope } from './state';
import { type StarStorage, StarSync } from './sync';

export function browserStorage(): StarStorage {
  let legacy: ReturnType<typeof createStore>;
  const storage = durableStorage<{
    version: 2;
    source?: unknown;
    erased?: string[];
    root: StarRoot;
  }>(
    'podcst-lists-v2',
    () => ({ version: 2, root: {} }),
    (
      value,
    ): value is {
      version: 2;
      source?: unknown;
      erased?: string[];
      root: StarRoot;
    } => {
      const stored = value as { version: number; root: StarRoot };
      return (
        !!stored &&
        stored.version === 2 &&
        !!stored.root &&
        Object.entries(stored.root).every(
          ([key, state]) =>
            validStarScope(state) &&
            (!state.wire || key === `account:${state.wire.accountId}`),
        )
      );
    },
  );
  const initialize = async () => {
    const installed = await storage.load();
    if (installed.source !== undefined) return installed;
    legacy ??= createStore('podcst-lists', 'state');
    const source = await get('root', legacy);
    return storage.update((stored) => {
      if (stored.source !== undefined) return;
      if (source !== undefined) stored.root = convertStars(source);
      stored.source = source ?? null;
    });
  };
  return {
    load: async () => (await initialize()).root,
    erase: async (account) => {
      const key = `account:${account}`;
      await storage.update((stored) => {
        delete stored.root[key];
        stored.erased ??= [];
        if (!stored.erased.includes(key)) stored.erased.push(key);
        if (stored.source && typeof stored.source === 'object')
          delete (stored.source as Record<string, unknown>)[key];
      });
      legacy ??= createStore('podcst-lists', 'state');
      await update<Record<string, unknown>>(
        'root',
        (source) => {
          if (source) delete source[key];
          return source ?? {};
        },
        legacy,
      );
    },
    update: async (change) => {
      await initialize();
      return (
        await storage.update((stored) => {
          change(stored.root);
          if (stored.erased?.some((key) => key in stored.root))
            throw new Error('Account terminally erased');
        })
      ).root;
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
          const result = await request<ListsSnapshot>('');
          await confirm();
          return result;
        },
        membership: (id) => request(`/${id}/items?view=membership`),
        migration: (id, scope, batch) =>
          request(`/${id}/migration`, { ...scope, batch }),
        changes: (id, batch) => request(`/${id}/changes`, batch),
        episodes: (id, cursor) =>
          request(
            `/${id}/items?view=episodes${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          ),
      },
      async (work) => {
        if (!navigator.locks)
          throw new Error('Cross-tab synchronization is unavailable');
        await navigator.locks.request('podcst-list-sender', async (lock) => {
          if (lock) await work();
        });
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
  const unregister = session.registerLifecycle({
    suspend: () => runtime.sync.suspend(),
    erase: (account) => runtime.sync.erase(account),
  });
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
    unregister();
    clearInterval(timer);
    window.removeEventListener('online', refresh);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
    runtime.notify = () => {};
    channel.close();
    void runtime.sync.activate(undefined);
  };
}
