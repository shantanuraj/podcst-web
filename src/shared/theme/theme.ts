import { STORE_KEY } from '@/shared/storage/local';

export const themePreferences = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof themePreferences)[number];
export type Theme = 'light' | 'dark';

export const darkQuery = '(prefers-color-scheme: dark)';

export const resolveTheme = (
  preference: ThemePreference,
  systemDark: boolean,
): Theme =>
  preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

export const applyTheme = (theme: Theme) =>
  document.documentElement.classList.toggle('light', theme === 'light');

export const themeScript = `try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(STORE_KEY)})||'{}').themeMode;document.documentElement.classList.toggle('light',p==='light'||(p!=='dark'&&!matchMedia(${JSON.stringify(darkQuery)}).matches))}catch(e){}`;
