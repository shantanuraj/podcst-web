import { useEffect, useReducer } from 'react';
import { useStorage } from '../storage/useStorage';
import { SubscriptionsContext } from './context';
import { subscriptionsReducer } from './store';

type SubscriptionsProviderProps = { children: React.ReactNode };

export function SubscriptionsProvider({ children }: SubscriptionsProviderProps) {
  const [storedSubscriptions, updateSubscriptions] = useStorage('subscriptions');
  const [subs, dispatch] = useReducer(subscriptionsReducer, storedSubscriptions ?? {});

  useEffect(() => {
    updateSubscriptions(subs);
  }, [subs, updateSubscriptions]);

  return (
    <SubscriptionsContext.Provider value={{ subs, dispatch }}>
      {children}
    </SubscriptionsContext.Provider>
  );
}
