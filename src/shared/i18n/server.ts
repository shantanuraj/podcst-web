import { cookies } from 'next/headers';
import { defaultLanguage, en, type Language, type Messages } from '@/messages';
import {
  getMessagesForLanguage,
  getNestedValue,
  isValidLanguage,
  LANGUAGE_COOKIE,
  type TranslationKey,
  translateKey,
} from './shared';

async function getLanguageFromCookie(): Promise<Language> {
  const cookieStore = await cookies();
  const lang = cookieStore.get(LANGUAGE_COOKIE)?.value;
  if (lang && isValidLanguage(lang)) {
    return lang;
  }
  return defaultLanguage;
}

export async function translations() {
  const language = await getLanguageFromCookie();
  const messages = getMessagesForLanguage(language);

  const t = (
    key: TranslationKey,
    params?: Record<string, string | number>,
  ): string => {
    let value = translateKey(messages, key, params);

    if (value === key && language !== 'en') {
      value = getNestedValue(en, key);
      if (params) {
        for (const [paramKey, paramValue] of Object.entries(params)) {
          value = value.replace(
            new RegExp(`\\{${paramKey}\\}`, 'g'),
            String(paramValue),
          );
        }
      }
    }

    return value;
  };

  return { language, t, messages };
}
