import { create } from 'zustand';

import { ThemeMode } from '@/types';
import { getValue } from '@/shared/storage/local';

type ThemeState = {
  theme: ThemeMode;
  changeTheme: (theme: ThemeMode) => void;
  cycleTheme: () => void;
};

export const useTheme = create<ThemeState>((set, get) => ({
  theme: getValue('themeMode', 'light'),
  changeTheme: (theme) => set({ theme }),
  cycleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
}));
