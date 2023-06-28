'use client';

import { useEffect } from 'react';

import { setValue } from '../storage/local';
import { useTheme } from './useTheme';

export function ThemeListener() {
  const { theme } = useTheme();
  useEffect(() => {
    setValue('themeMode', theme);
    if (typeof window === 'undefined') return;
    if (theme === 'light') document.documentElement.classList.add('light');
    else document.documentElement.classList.remove('light');
  }, [theme]);
  return null;
}
