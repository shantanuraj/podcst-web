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

function resolvePluralForm(count: number, formsStr: string): string {
  const formPattern = /(zero|one|two|few|many|other|=\d+)\s*\{([^{}]*)\}/g;
  const forms: Record<string, string> = {};
  let match: RegExpExecArray | null;

  while ((match = formPattern.exec(formsStr)) !== null) {
    forms[match[1]] = match[2];
  }

  if (forms[`=${count}`] !== undefined) return forms[`=${count}`];
  if (count === 1 && forms.one !== undefined) return forms.one;
  if (count === 0 && forms.zero !== undefined) return forms.zero;
  return forms.other ?? '';
}

function resolveArgument(
  content: string,
  params: Record<string, string | number>,
): string {
  const parts = content.split(',').map((s) => s.trim());
  const varName = parts[0];
  const value = params[varName];

  if (value === undefined) return `{${content}}`;

  if (parts[1] === 'plural') {
    const formsStart = content.indexOf('plural,') + 7;
    return resolvePluralForm(Number(value), content.slice(formsStart));
  }

  return String(value);
}

export function translateKey(
  messages: Messages,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const template = getNestedValue(messages, key);
  if (!params) return template;

  let result = '';
  let depth = 0;
  let argStart = -1;

  for (let i = 0; i < template.length; i++) {
    const char = template[i];

    if (char === '{') {
      if (depth === 0) argStart = i + 1;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && argStart !== -1) {
        result += resolveArgument(template.slice(argStart, i), params);
        argStart = -1;
      }
    } else if (depth === 0) {
      result += char;
    }
  }

  return result;
}
