export const i18n = {
  locales: ['us', 'nl', 'ca', 'kr', 'my', 'in', 'mx', 'fr', 'se', 'no'],
  defaultLocale: 'us',
} as const;

export type Locale = (typeof i18n)['locales'][number];
