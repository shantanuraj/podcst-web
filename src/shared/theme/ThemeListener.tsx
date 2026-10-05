'use client';

import { useEffect } from 'react';
import { setValue } from '@/shared/storage/local';
import { applyTheme, darkQuery } from './theme';
import { useTheme, useThemeStore } from './useTheme';

export function ThemeListener() {
  const { preference, theme } = useTheme();

  useEffect(() => {
    const media = window.matchMedia(darkQuery);
    const change = () => useThemeStore.getState().setSystemDark(media.matches);
    change();
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => setValue('themeMode', preference), [preference]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return null;
}
