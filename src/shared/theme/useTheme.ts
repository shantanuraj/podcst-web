import { useContext } from 'react';
import { ThemeContext } from './context';

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw Error('useTheme must be used within the ThemeProvider');
  return value;
}
