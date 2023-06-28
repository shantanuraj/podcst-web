'use client';

import { useEffect } from 'react';
import { useGlobalShortcuts } from '../shared/keyboard/useGlobalShortcuts';
import { removeDeprecatedStorage } from '../shared/storage/local';
import { useSubscriptions, getInit } from '../shared/subscriptions/useSubscriptions';

export function Init() {
  useEffect(removeDeprecatedStorage, []);
  useGlobalShortcuts();
  const init = useSubscriptions(getInit);
  useEffect(() => {
    init();
  }, []);

  return null;
}
