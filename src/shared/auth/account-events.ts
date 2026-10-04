import type { AccountSession } from './account-session';

export const ACCOUNT_EVENT = 'podcst-account-change';

export function connectAccountEvents(
  session: AccountSession,
  target: Window,
  channel?: BroadcastChannel,
) {
  const seen = new Set<string>();
  const receive = (value: unknown) => {
    const id = (value as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || id.length > 128 || seen.has(id)) return;
    seen.add(id);
    const oldest = seen.values().next().value;
    if (seen.size > 20 && oldest !== undefined) seen.delete(oldest);
    session.externalChange();
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== ACCOUNT_EVENT || !event.newValue) return;
    try {
      receive(JSON.parse(event.newValue));
    } catch {}
  };
  const message = (event: MessageEvent) => receive(event.data);
  const check = () => {
    void session.refresh();
  };
  const visible = () => {
    if (target.document.visibilityState === 'visible') check();
  };
  const show = (event: PageTransitionEvent) => {
    if (event.persisted) session.externalChange();
    else check();
  };
  target.addEventListener('storage', storage);
  target.addEventListener('focus', check);
  target.addEventListener('pageshow', show);
  target.document.addEventListener('visibilitychange', visible);
  channel?.addEventListener('message', message);
  const timer = target.setInterval(() => {
    if (session.scope !== null || !session.getSnapshot().ready) check();
  }, 60_000);
  session.synchronizePlayer();
  check();
  return {
    publish() {
      const value = { id: crypto.randomUUID() };
      try {
        channel?.postMessage(value);
      } catch {}
      try {
        target.localStorage.setItem(ACCOUNT_EVENT, JSON.stringify(value));
      } catch {}
    },
    close() {
      target.clearInterval(timer);
      target.removeEventListener('storage', storage);
      target.removeEventListener('focus', check);
      target.removeEventListener('pageshow', show);
      target.document.removeEventListener('visibilitychange', visible);
      channel?.removeEventListener('message', message);
      channel?.close();
      session.stopChecking();
    },
  };
}
