'use client';

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { defaultLanguage, en, type Language, type Messages } from '@/messages';
import {
  getMessagesForLanguage,
  isValidLanguage,
  LANGUAGE_COOKIE,
  type TranslationKey,
  translateKey,
} from './shared';

function getStoredLanguage(): Language {
  if (typeof document === 'undefined') return defaultLanguage;
  const match = document.cookie.match(new RegExp(`${LANGUAGE_COOKIE}=([^;]+)`));
  const lang = match?.[1];
  if (lang && isValidLanguage(lang)) {
    return lang;
  }
  return defaultLanguage;
}

interface TranslationContextValue {
  language: Language;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  messages: Messages;
}

const TranslationContext = createContext<TranslationContextValue>({
  language: defaultLanguage,
  t: (key) => key,
  messages: en,
});

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(defaultLanguage);

  useEffect(() => {
    setLanguage(getStoredLanguage());

    const handleCookieChange = () => {
      setLanguage(getStoredLanguage());
    };

    const interval = setInterval(handleCookieChange, 1000);
    return () => clearInterval(interval);
  }, []);

  const messages = getMessagesForLanguage(language);

  const t = (
    key: TranslationKey,
    params?: Record<string, string | number>,
  ): string => {
    let value = translateKey(messages, key, params);

    // Fallback to English if translation not found for non-English languages
    if (value === key && language !== 'en') {
      value = translateKey(en, key, params);
    }

    return value;
  };

  return (
    <TranslationContext.Provider value={{ language, t, messages }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  return useContext(TranslationContext);
}
