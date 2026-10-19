'use client';

import { useParams, useRouter } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
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
  setLanguage: (language: Language) => void;
}

const TranslationContext = createContext<TranslationContextValue>({
  language: defaultLanguage,
  t: (key) => key,
  messages: en,
  setLanguage: () => {},
});

export function TranslationProvider({ children }: { children: ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const routeLanguage =
    typeof params?.language === 'string' && isValidLanguage(params.language)
      ? params.language
      : null;
  const [storedLanguage, setLanguage] = useState<Language>(
    routeLanguage ?? defaultLanguage,
  );
  // Explicit route params keep cached HTML and its first client render aligned.
  const language = routeLanguage ?? storedLanguage;

  useEffect(() => {
    setLanguage(routeLanguage ?? getStoredLanguage());
  }, [routeLanguage]);

  const chooseLanguage = useCallback(
    (next: Language) => {
      document.cookie = `${LANGUAGE_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
      setLanguage(next);
      router.refresh();
    },
    [router],
  );

  const messages = getMessagesForLanguage(language);

  const t = (
    key: TranslationKey,
    params?: Record<string, string | number>,
  ): string => {
    let value = translateKey(messages, key, params);
    if (value === key && language !== 'en') {
      value = translateKey(en, key, params);
    }

    return value;
  };

  return (
    <TranslationContext.Provider
      value={{ language, t, messages, setLanguage: chooseLanguage }}
    >
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  return useContext(TranslationContext);
}
