'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useState, useRef, useEffect } from 'react';
import { i18n, type Locale } from '@/i18.conf';
import { Icon } from '@/ui/icons/svg/Icon';
import styles from './LocaleSwitcher.module.css';

const LOCALE_COOKIE = 'NEXT_LOCALE';

const localeNames: Record<Locale, string> = {
  us: 'United States',
  nl: 'Netherlands',
  ca: 'Canada',
  kr: 'South Korea',
  my: 'Malaysia',
  in: 'India',
  mx: 'Mexico',
  fr: 'France',
  se: 'Sweden',
  no: 'Norway',
};

const sortedLocales = [...i18n.locales].sort((a, b) =>
  localeNames[a].localeCompare(localeNames[b]),
);

function getCurrentLocale(pathname: string): Locale {
  for (const locale of i18n.locales) {
    if (pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`) {
      return locale;
    }
  }
  return i18n.defaultLocale;
}

function getNewPath(pathname: string, currentLocale: Locale, newLocale: Locale): string {
  if (pathname.startsWith(`/${currentLocale}/`)) {
    return pathname.replace(`/${currentLocale}/`, `/${newLocale}/`);
  }
  if (pathname === `/${currentLocale}`) {
    return `/${newLocale}`;
  }
  return `/${newLocale}${pathname}`;
}

export function LocaleSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentLocale = getCurrentLocale(pathname);

  const handleLocaleChange = useCallback(
    (newLocale: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${newLocale};path=/;max-age=31536000`;
      const newPath = getNewPath(pathname, currentLocale, newLocale);
      router.push(newPath);
      setIsOpen(false);
    },
    [pathname, currentLocale, router],
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Change region (current: ${localeNames[currentLocale]})`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <Icon icon="globe" size={20} />
        <span className={styles.label}>{currentLocale.toUpperCase()}</span>
      </button>
      {isOpen && (
        <ul className={styles.menu} role="listbox">
          {sortedLocales.map((locale) => (
            <li key={locale} role="option" aria-selected={locale === currentLocale}>
              <button
                type="button"
                className={styles.option}
                data-active={locale === currentLocale}
                onClick={() => handleLocaleChange(locale)}
              >
                <span className={styles.code}>{locale.toUpperCase()}</span>
                <span className={styles.name}>{localeNames[locale]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

