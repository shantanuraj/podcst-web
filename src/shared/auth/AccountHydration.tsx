'use client';

import { type DehydratedState, HydrationBoundary } from '@tanstack/react-query';
import { type ReactNode, useRef } from 'react';
import { useAccountSession } from './AccountBoundary';
import type { AccountScope } from './account';

export function AccountHydration({
  scope,
  resource,
  state,
  children,
}: {
  scope: AccountScope;
  resource: string;
  state: DehydratedState;
  children: ReactNode;
}) {
  const session = useAccountSession();
  const token = session.token();
  const revision = useRef(token.revision).current;
  if (
    scope !== token.scope ||
    revision !== token.revision ||
    !session.current(token, resource)
  )
    return children;
  return <HydrationBoundary state={state}>{children}</HydrationBoundary>;
}
