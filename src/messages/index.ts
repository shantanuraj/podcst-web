import { messages as en, type Messages } from './en';

export type { Messages };

export const defaultLocale = 'en';

export function getMessages(_locale: string): Messages {
  return en;
}

