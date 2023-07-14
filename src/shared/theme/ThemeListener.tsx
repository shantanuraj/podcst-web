'use client';

import { useEffect } from 'react';

import { setValue } from '@/shared/storage/local';
import { useTheme } from './useTheme';

export function ThemeListener() {
  const { scheme, theme } = useTheme();
  useEffect(() => {
    setValue('scheme', scheme);
    if (typeof window === 'undefined') return;
    document.documentElement.dataset.scheme = scheme;
  }, [scheme]);

  useEffect(() => {
    setValue('themeMode', theme);
    if (typeof window === 'undefined') return;
    if (theme === 'light') document.documentElement.classList.add('light');
    else document.documentElement.classList.remove('light');
  }, [theme]);
  return null;
}
