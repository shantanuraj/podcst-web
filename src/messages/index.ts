import { messages as en, type Messages } from './en';

export type { Messages };
export { en };

export type Language = 'en' | 'nl' | 'fr' | 'sv' | 'ko' | 'es';

export const defaultLanguage: Language = 'en';

export const languageNames: Record<
  Language,
  { native: string; english: string }
> = {
  en: { native: 'English', english: 'English' },
  nl: { native: 'Nederlands', english: 'Dutch' },
  fr: { native: 'Français', english: 'French' },
  sv: { native: 'Svenska', english: 'Swedish' },
  ko: { native: '한국어', english: 'Korean' },
  es: { native: 'Español', english: 'Spanish' },
};
