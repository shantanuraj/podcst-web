'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { i18n, type Locale } from '@/i18.conf';
import { useTranslation } from '@/shared/i18n';
import styles from './RegionPicker.module.css';

const LOCALE_COOKIE = 'NEXT_LOCALE';

function getLocaleFromPath(pathname: string): Locale | null {
  for (const locale of i18n.locales) {
    if (pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`) {
      return locale;
    }
  }
  return null;
}

function getLocaleFromCookie(): Locale | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`${LOCALE_COOKIE}=([^;]+)`));
  const value = match?.[1];
  if (value && i18n.locales.includes(value as Locale)) {
    return value as Locale;
  }
  return null;
}

function getCurrentLocale(pathname: string): Locale {
  return (
    getLocaleFromPath(pathname) ?? getLocaleFromCookie() ?? i18n.defaultLocale
  );
}

export function RegionPicker() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const [currentLocale, setCurrentLocale] = useState<Locale>(
    i18n.defaultLocale,
  );

  useEffect(() => {
    const detected = getCurrentLocale(pathname);
    setCurrentLocale(detected);
    document.cookie = `${LOCALE_COOKIE}=${detected};path=/;max-age=31536000`;
  }, [pathname]);

  useEffect(() => {
    function onLocaleChange() {
      const cookieLocale = getLocaleFromCookie();
      if (cookieLocale) setCurrentLocale(cookieLocale);
    }
    window.addEventListener('locale-change', onLocaleChange);
    return () => window.removeEventListener('locale-change', onLocaleChange);
  }, []);

  const sortedLocales = [...i18n.locales].sort((a, b) =>
    t(`regions.${a}` as const).localeCompare(t(`regions.${b}` as const)),
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newLocale = e.target.value as Locale;
      document.cookie = `${LOCALE_COOKIE}=${newLocale};path=/;max-age=31536000`;
      setCurrentLocale(newLocale);
      const pathLocale = getLocaleFromPath(pathname);
      if (pathLocale) {
        const newPath = pathname.replace(`/${pathLocale}/`, `/${newLocale}/`);
        router.push(newPath);
      } else {
        window.dispatchEvent(new Event('locale-change'));
      }
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
