import { i18n, type Locale } from '@/i18.conf';

export const REGION_COOKIE = 'NEXT_LOCALE';

export const isRegion = (value: unknown): value is Locale =>
  i18n.locales.includes(value as Locale);

export function regionFromLanguages(tags: Iterable<string>): Locale | null {
  for (const tag of tags) {
    try {
      const region = new Intl.Locale(tag).region?.toLowerCase();
      if (isRegion(region)) return region;
    } catch {}
  }
  return null;
}

export function requestRegion(
  saved: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (isRegion(saved)) return saved;
  const languages = (acceptLanguage ?? '')
    .split(',')
    .map((part) => part.split(';')[0].trim())
    .filter(Boolean);
  return regionFromLanguages(languages) ?? i18n.defaultLocale;
}

export function readRegion(): Locale | null {
  const value = document.cookie.match(
    new RegExp(`(?:^|; )${REGION_COOKIE}=([^;]+)`),
  )?.[1];
  return isRegion(value) ? value : null;
}

export function writeRegion(region: Locale) {
  document.cookie = `${REGION_COOKIE}=${region};path=/;max-age=31536000;samesite=lax`;
}
