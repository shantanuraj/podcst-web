import { useContext } from 'react';
import { SubscriptionsContext } from './context';

export function useSubscriptions() {
  const value = useContext(SubscriptionsContext);
  if (!value) throw Error('useSubscriptions must be used within the SubscriptionsProvider');
  return value;
}
