import create from 'zustand';

import { ThemeMode } from '../../types';
import { getValue, setValue } from '../storage/storage';

type ThemeState = {
  theme: ThemeMode;
  changeTheme: (theme: ThemeMode) => void;
  cycleTheme: () => void;
};

export const useTheme = create<ThemeState>((set, get) => ({
  theme: getValue('themeMode', 'dark'),
  changeTheme: (theme) => set({ theme }),
  cycleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
}));

useTheme.subscribe(({ theme }) => {
  setValue('themeMode', theme);
  if (typeof window === 'undefined') return;
  if (theme === 'light') document.documentElement.classList.add('light');
  else document.documentElement.classList.remove('light');
});
