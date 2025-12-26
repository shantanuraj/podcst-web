'use client';

import { useEffect } from 'react';
import { useGlobalShortcuts } from '@/shared/keyboard/useGlobalShortcuts';
import {
  getInit,
  useSubscriptions,
} from '@/shared/subscriptions/useSubscriptions';

export function Init() {
  useGlobalShortcuts();
  const init = useSubscriptions(getInit);
  useEffect(() => {
    init();
  }, [init]);

  return null;
}
