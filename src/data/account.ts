import { useMutation, useQuery } from '@tanstack/react-query';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { accountQueryKey } from '@/shared/auth/account';
import type { Preferences } from '@/shared/preferences';
import { get, responseData } from './api';

export interface AccountPasskey {
  id: string;
  provider: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AccountDetails {
  createdAt: string | null;
  passkeys: AccountPasskey[];
  preferences: Preferences;
}

export function useAccountDetails() {
  const session = useAccountSession();
  const token = session.token();
  const options = session.query('account', 'account', (signal) =>
    get<AccountDetails>('/account', {}, undefined, signal),
  );
  const query = useQuery({
    ...options,
    enabled: options.enabled && token.scope !== null,
    staleTime: 60_000,
  });
  return {
    ...query,
    data: session.current(token, 'account') ? query.data : undefined,
  };
}

export function useSavePreferences() {
  const session = useAccountSession();
  const token = session.token();
  const key = accountQueryKey(token.scope, 'account', 'account');
  return useMutation({
    mutationKey: accountQueryKey(token.scope, 'save-preferences'),
    mutationFn: (preferences: Preferences) =>
      session.run(token, 'account', async (signal) =>
        responseData<Preferences>(
          await fetch('/api/account/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(preferences),
            signal,
          }),
        ),
      ),
    onMutate: (preferences) => {
      if (session.current(token))
        session.client.setQueryData<AccountDetails>(key, (details) =>
          details ? { ...details, preferences } : details,
        );
    },
    onSettled: () => {
      if (session.current(token))
        void session.client.invalidateQueries({ queryKey: key });
    },
  });
}

export function useRemovePasskey() {
  const session = useAccountSession();
  const token = session.token();
  return useMutation({
    mutationKey: accountQueryKey(token.scope, 'remove-passkey'),
    mutationFn: (passkeyId: string) =>
      session.run(token, 'account', async (signal) =>
        responseData(
          await fetch(
            `/api/account/passkeys/${encodeURIComponent(passkeyId)}`,
            {
              method: 'DELETE',
              signal,
            },
          ),
        ),
      ),
    onSettled: () => {
      if (!session.current(token)) return;
      void session.client.invalidateQueries({
        queryKey: accountQueryKey(token.scope, 'account', 'account'),
      });
      void session.refresh();
    },
  });
}
