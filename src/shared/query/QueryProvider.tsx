'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AccountContext } from '@/shared/auth/AccountBoundary';
import type { AccountUser } from '@/shared/auth/account';
import {
  ACCOUNT_EVENT,
  connectAccountEvents,
} from '@/shared/auth/account-events';
import { AccountSession } from '@/shared/auth/account-session';
import { usePlayer } from '@/shared/player/usePlayer';

export function QueryProvider({
  children,
  user,
}: {
  children: React.ReactNode;
  user: AccountUser | null;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  const events = useRef<ReturnType<typeof connectAccountEvents> | null>(null);
  const [session] = useState(
    () =>
      new AccountSession(queryClient, user, {
        resetPlayer: (scope, revision) =>
          usePlayer.getState().setAccount(scope, revision),
        reload: () => window.location.reload(),
        publish: () => events.current?.publish(),
      }),
  );
  useEffect(() => {
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? undefined
        : new BroadcastChannel(ACCOUNT_EVENT);
    const connection = connectAccountEvents(session, window, channel);
    events.current = connection;
    return () => {
      events.current = null;
      connection.close();
    };
  }, [session]);
  return (
    <QueryClientProvider client={queryClient}>
      <AccountContext.Provider value={session}>
        {children}
      </AccountContext.Provider>
    </QueryClientProvider>
  );
}
