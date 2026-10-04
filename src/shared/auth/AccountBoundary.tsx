'use client';

import {
  createContext,
  type ReactNode,
  useContext,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { AccountScope } from './account';
import type { AccountSession } from './account-session';

export const AccountContext = createContext<AccountSession | null>(null);

export function useAccountSession() {
  const session = useContext(AccountContext);
  if (!session) throw new Error('Account boundary required');
  useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  return session;
}

export function AccountContent({
  scope,
  resource,
  privateContent,
  children,
}: {
  scope: AccountScope;
  resource: string | number;
  privateContent: boolean;
  children: ReactNode;
}) {
  const session = useAccountSession();
  const state = session.getSnapshot();
  const revision = useRef(state.revision).current;
  const unavailable =
    state.denied.has(resource) ||
    (privateContent &&
      (!state.ready || session.scope !== scope || state.revision !== revision));
  if (unavailable)
    return (
      <div role="status">
        Content unavailable for this session.{' '}
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  return children;
}
