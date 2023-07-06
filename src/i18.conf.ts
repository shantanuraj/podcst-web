export const i18n = {
  locales: ['us', 'nl', 'ca', 'kr', 'my', 'in'],
  defaultLocale: 'us',
} as const;

export type Locale = (typeof i18n)['locales'][number];
