import { useEffect } from 'react';
import { ThemeMode } from '../../types';
import { useStorage } from '../storage/useStorage';
import { ThemeContext } from './context';

export const ThemProvider: React.FC = ({ children }) => {
  const [theme, changeTheme] = useStorage('themeMode', 'dark');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (theme === 'light') document.documentElement.classList.add('light');
    else document.documentElement.classList.remove('light');
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme: theme as ThemeMode, changeTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
