import { messages as en, type Messages } from './en';
import { messages as es } from './es';
import { messages as fr } from './fr';
import { messages as hi } from './hi';
import { messages as ko } from './ko';
import { messages as nl } from './nl';
import { messages as sv } from './sv';

export type { Messages };
export { en };

export type Language = 'en' | 'nl' | 'fr' | 'sv' | 'ko' | 'es' | 'hi';

export const defaultLanguage: Language = 'en';

export const messagesByLanguage: Record<Language, Messages> = {
  en,
  nl,
  fr,
  sv,
  ko,
  es,
  hi,
};

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
  hi: { native: 'हिन्दी', english: 'Hindi' },
};
