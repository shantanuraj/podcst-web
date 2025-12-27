'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { i18n, type Locale } from '@/i18.conf';
import { useTranslation } from '@/shared/i18n';
import styles from './RegionPicker.module.css';

const LOCALE_COOKIE = 'NEXT_LOCALE';

function getCurrentLocale(pathname: string): Locale {
  for (const locale of i18n.locales) {
    if (pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`) {
      return locale;
    }
  }
  return i18n.defaultLocale;
}

export function RegionPicker() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const currentLocale = getCurrentLocale(pathname);

  const sortedLocales = [...i18n.locales].sort((a, b) =>
    t(`regions.${a}` as const).localeCompare(t(`regions.${b}` as const)),
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newLocale = e.target.value as Locale;
      document.cookie = `${LOCALE_COOKIE}=${newLocale};path=/;max-age=31536000`;

      const localePattern = new RegExp(`^/(${i18n.locales.join('|')})`);
      const pathWithoutLocale = pathname.replace(localePattern, '');
      const newPath = `/${newLocale}${pathWithoutLocale || '/feed/top'}`;

      router.push(newPath);
    },
    [pathname, router],
  );

  return (
    <div className={styles.grid}>
      {sortedLocales.map((locale) => {
        const isSelected = locale === currentLocale;
        return (
          <label
            key={locale}
            className={styles.option}
            data-selected={isSelected}
          >
            <input
              type="radio"
              name="region"
              value={locale}
              checked={isSelected}
              onChange={handleChange}
              className="sr-only"
            />
            <span className={styles.code}>{locale.toUpperCase()}</span>
            <span className={styles.name}>
              {t(`regions.${locale}` as const)}
            </span>
          </label>
        );
      })}
    </div>
  );
}
