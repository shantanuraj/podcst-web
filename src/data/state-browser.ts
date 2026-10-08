import { get } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import { responseData } from '@/data/api';
import { StateRuntime } from '@/data/state-runtime';
import { browserStateStorage, convertGuestFollows } from '@/data/state-storage';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import type { AccountSession } from '@/shared/auth/account-session';
import { followProjection } from '@/shared/subscriptions/follow-outbox';
import { type ProgressPosition, progressProjection } from './progress-outbox';

const runtimes = new WeakMap<
  AccountSession,
  { sync: StateRuntime; notify: () => void }
>();
export function stateRuntime(session: AccountSession) {
  const existing = runtimes.get(session);
  if (existing) return existing;
  const runtime = {
    notify: () => {},
    sync: new StateRuntime(
      browserStateStorage(),
      {
        request: (path, method = 'GET', body) => {
          const token = session.token();
          return session.run(token, 'durable-state', async (signal) =>
            responseData(
              await fetch(`/api${path}`, {
                method,
                cache: 'no-store',
                body: body === undefined ? undefined : JSON.stringify(body),
                headers:
                  body === undefined
                    ? undefined
                    : { 'Content-Type': 'application/json' },
                signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
              }),
            ),
          );
        },
      },
      async (work) => {
        if (!navigator.locks)
          throw new Error('Cross-tab serialization unavailable');
        await navigator.locks.request('podcst-progress-follows', work);
      },
      () => runtime.notify(),
    ),
  };
  runtimes.set(session, runtime);
  return runtime;
}
export function connectState(session: AccountSession) {
  const runtime = stateRuntime(session);
  const channel = new BroadcastChannel('podcst-durable-state');
  runtime.notify = () => {
    channel.postMessage('changed');
  };
  channel.onmessage = () => {
    void runtime.sync.reload();
  };
  let installed = '';
  const watch = runtime.sync.subscribe(() => {
    const view = runtime.sync.getSnapshot();
    const state = view.account ? view.state?.accounts[view.account] : undefined;
    const key = `${view.account}:${state?.progress.revision}:${state?.follows.snapshot?.revision}`;
    if (key === installed) return;
    installed = key;
    if (session.scope !== view.account) return;
    for (const kind of ['subscriptions', 'podcast-progress', 'recent-progress'])
      void session.client.invalidateQueries({
        queryKey: ['account', session.scope, kind],
      });
  });
  let revision = -1;
  let ready = false;
  const activate = () => {
    const next = session.getSnapshot();
    if (next.revision === revision && ready === next.ready) return;
    revision = next.revision;
    ready = next.ready;
    void runtime.sync.activate(next.ready ? session.scope : undefined);
  };
  const unsubscribe = session.subscribe(activate);
  activate();
  void get('subscriptions')
    .then(async (source) => {
      if (source !== undefined)
        await runtime.sync.storage.update((root) =>
          convertGuestFollows(root, source),
        );
      await runtime.sync.reload();
      await runtime.sync.refresh();
    })
    .catch(() =>
      runtime.sync.storageFailure(
        'Older guest follows could not be converted. Source data retained.',
      ),
    );
  const refresh = () => {
    if (document.visibilityState === 'visible') void runtime.sync.refresh();
  };
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  const timer = setInterval(refresh, 5000);
  const unregister = session.registerLifecycle({
    suspend: () => runtime.sync.suspend(),
    erase: (account) => runtime.sync.erase(account),
  });
  return () => {
    unsubscribe();
    unregister();
    watch();
    clearInterval(timer);
    channel.close();
    runtime.notify = () => {};
    window.removeEventListener('online', refresh);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
    void runtime.sync.suspend().catch(() => {});
  };
}
export function useDurableState() {
  const session = useAccountSession();
  const { sync } = stateRuntime(session);
  const view = useSyncExternalStore(
    sync.subscribe,
    sync.getSnapshot,
    sync.getSnapshot,
  );
  const current = session.getSnapshot().ready && view.account === session.scope;
  const state = current ? view.state : undefined;
  const account = session.scope ? state?.accounts[session.scope] : undefined;
  const progress =
    account?.progress ??
    (session.scope === null ? state?.guest.progress : undefined);
  const follows = account?.follows;
  const token = session.token();
  return {
    guestProgress: state
      ? [...progressProjection(state.guest.progress).values()]
      : [],
    canTransferGuestProgress:
      !!account?.progress.scope && !account.progress.blocked,
    transferGuestProgress: (selection: ProgressPosition) => {
      if (!token.scope || !session.current(token))
        return Promise.reject(new Error('Verified account changed'));
      return sync.transferGuestProgress(token.scope, selection);
    },
    sync,
    progress: progress ? progressProjection(progress) : new Map(),
    follows: follows
      ? followProjection(follows)
      : new Map((state?.guest.follows ?? []).map((id) => [id, 'available'])),
    initialized: !!state,
    unresolvedFollows: state?.legacyFollows?.unresolved ?? [],
    unresolvedImports: follows?.importFailures ?? [],
    pending:
      session.scope !== null &&
      !!(
        progress?.flight ||
        progress?.queued.length ||
        follows?.flight ||
        follows?.queued.length
      ),
    error: current
      ? (progress?.blocked ??
        follows?.blocked ??
        (progress?.failures.length || follows?.failures.length
          ? 'Some changes could not be applied.'
          : undefined) ??
        (state?.legacyFollows?.unresolved.length
          ? 'Some older follows need resolution; source data retained.'
          : undefined) ??
        view.error)
      : undefined,
  };
}
export function DurableStateStatus() {
  const state = useDurableState();
  return state.error || state.pending
    ? `${state.error ?? 'Saved on this device. Waiting to sync…'}`
    : null;
}
