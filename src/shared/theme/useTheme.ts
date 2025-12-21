import { create } from 'zustand';
import { getValue } from '@/shared/storage/local';
import type { ThemeMode } from '@/types';

const schemes = ['autumn', 'spring', 'rose', 'winter'] as const;

export type Scheme = (typeof schemes)[number];

export type ThemeConfig = `${Scheme}/${ThemeMode}`;

export interface IThemeInfo {
  scheme: Scheme;
  theme: ThemeMode;
}

export const themes: readonly IThemeInfo[] = schemes
  .map(
    (scheme): IThemeInfo => ({
      scheme,
      theme: 'light',
    }),
  )
  .concat({
    scheme: 'autumn',
    theme: 'dark',
  });

type ThemeState = {
  currentIndex: number;
  themes: readonly IThemeInfo[];
  scheme: Scheme;
  theme: ThemeMode;
  changeTheme: (scheme: Scheme, theme: ThemeMode) => void;
  cycleScheme: (direction: 'left' | 'right') => void;
  toggleDarkMode: () => void;
};

const currentIndex = 0;
const defaultScheme = schemes[currentIndex];

export const useTheme = create<ThemeState>((set, get) => ({
  currentIndex,
  themes,
  scheme: getValue('scheme', defaultScheme),
  theme: getValue('themeMode', 'light'),
  changeTheme: (scheme, theme) => set({ scheme, theme }),
  cycleScheme: (direction) => {
    const { themes, currentIndex } = get();
    const tmpIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
    const nextIndex = tmpIndex < 0 ? themes.length - 1 : tmpIndex % themes.length;
    const { scheme, theme } = themes[nextIndex];
    set({ scheme, theme, currentIndex: nextIndex });
  },
  toggleDarkMode: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
}));
