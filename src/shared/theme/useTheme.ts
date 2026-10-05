import { create } from 'zustand';
import { getValue } from '@/shared/storage/local';
import {
  darkQuery,
  resolveTheme,
  type Theme,
  type ThemePreference,
  themePreferences,
} from './theme';

interface ThemeState {
  preference: ThemePreference;
  systemDark: boolean;
  setPreference: (preference: ThemePreference) => void;
  setSystemDark: (systemDark: boolean) => void;
  toggle: () => void;
}

const stored = getValue('themeMode');

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: themePreferences.includes(stored as ThemePreference)
    ? (stored as ThemePreference)
    : 'system',
  systemDark:
    typeof window === 'undefined' || window.matchMedia(darkQuery).matches,
  setPreference: (preference) => set({ preference }),
  setSystemDark: (systemDark) => set({ systemDark }),
  toggle: () => {
    const { preference, systemDark } = get();
    set({
      preference:
        resolveTheme(preference, systemDark) === 'dark' ? 'light' : 'dark',
    });
  },
}));

export function useTheme(): { preference: ThemePreference; theme: Theme } {
  const preference = useThemeStore((state) => state.preference);
  const systemDark = useThemeStore((state) => state.systemDark);
  return { preference, theme: resolveTheme(preference, systemDark) };
}
