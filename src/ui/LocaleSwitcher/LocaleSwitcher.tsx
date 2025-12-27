'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { i18n, type Locale } from '@/i18.conf';
import { useTranslation } from '@/shared/i18n';
import { Icon } from '@/ui/icons/svg/Icon';
import styles from './LocaleSwitcher.module.css';

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
  return getLocaleFromPath(pathname) ?? getLocaleFromCookie() ?? i18n.defaultLocale;
}

export function LocaleSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [locale, setLocale] = useState<Locale>(i18n.defaultLocale);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const detected = getCurrentLocale(pathname);
    setLocale(detected);
    document.cookie = `${LOCALE_COOKIE}=${detected};path=/;max-age=31536000`;
  }, [pathname]);

  useEffect(() => {
    function onLocaleChange() {
      const cookieLocale = getLocaleFromCookie();
      if (cookieLocale) setLocale(cookieLocale);
    }
    window.addEventListener('locale-change', onLocaleChange);
    return () => window.removeEventListener('locale-change', onLocaleChange);
  }, []);

  const sortedLocales = [...i18n.locales].sort((a, b) =>
    t(`regions.${a}` as const).localeCompare(t(`regions.${b}` as const)),
  );

  const handleLocaleChange = useCallback(
    (newLocale: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${newLocale};path=/;max-age=31536000`;
      setLocale(newLocale);
      setIsOpen(false);
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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
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
        aria-label={`Change region (current: ${t(`regions.${locale}` as const)})`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <Icon icon="globe" size={20} />
        <span className={styles.label}>{locale.toUpperCase()}</span>
      </button>
      {isOpen && (
        <ul className={styles.menu} role="listbox">
          {sortedLocales.map((l) => (
            <li key={l} role="option" aria-selected={l === locale}>
              <button
                type="button"
                className={styles.option}
                data-active={l === locale}
                onClick={() => handleLocaleChange(l)}
              >
                <span className={styles.code}>{l.toUpperCase()}</span>
                <span className={styles.name}>
                  {t(`regions.${l}` as const)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
