import {
  defaultLanguage,
  type Language,
  type Messages,
  messagesByLanguage,
} from '@/messages';

export const LANGUAGE_COOKIE = 'NEXT_UI_LANG';

export type NestedKeyOf<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}.${NestedKeyOf<T[K]>}`
          : K
        : never;
    }[keyof T]
  : never;

export type TranslationKey = NestedKeyOf<Messages>;

export function getNestedValue(obj: Messages, path: string): string {
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

export function isValidLanguage(lang: string): lang is Language {
  return lang in messagesByLanguage;
}

export function getMessagesForLanguage(language: Language): Messages {
  return messagesByLanguage[language] || messagesByLanguage[defaultLanguage];
}

export function translateKey(
  messages: Messages,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  let value = getNestedValue(messages, key);

  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      value = value.replace(
        new RegExp(`\\{${paramKey}\\}`, 'g'),
        String(paramValue),
      );
    }
  }

  return value;
}
