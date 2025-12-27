'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { en, type Messages, type Language, defaultLanguage } from '@/messages';

const LANGUAGE_COOKIE = 'NEXT_UI_LANG';

type NestedKeyOf<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}.${NestedKeyOf<T[K]>}`
          : K
        : never;
    }[keyof T]
  : never;

export type TranslationKey = NestedKeyOf<Messages>;

function getNestedValue(obj: Messages, path: string): string {
  const keys = path.split('.');
  let result: unknown = obj;
  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = (result as Record<string, unknown>)[key];
    } else {
      return path;
    }
  }
  return typeof result === 'string' ? result : path;
}

function getStoredLanguage(): Language {
  if (typeof document === 'undefined') return defaultLanguage;
  const match = document.cookie.match(new RegExp(`${LANGUAGE_COOKIE}=([^;]+)`));
  const lang = match?.[1];
  if (lang && ['en', 'nl', 'fr', 'sv', 'ko', 'es'].includes(lang)) {
    return lang as Language;
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

const messagesByLanguage: Record<Language, Messages> = {
  en,
  nl: en,
  fr: en,
  sv: en,
  ko: en,
  es: en,
};

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

  const messages = messagesByLanguage[language];

  const t = (
    key: TranslationKey,
    params?: Record<string, string | number>,
  ): string => {
    let value = getNestedValue(messages, key);

    if (value === key && language !== 'en') {
      value = getNestedValue(en, key);
    }

    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        value = value.replace(
          new RegExp(`\\{${paramKey}\\}`, 'g'),
          String(paramValue),
        );
      }
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
