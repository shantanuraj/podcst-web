'use client';

import Link from 'next/link';
import { useTranslation } from '@/shared/i18n';
import { LanguagePicker } from '@/ui/LanguagePicker';
import { RegionPicker } from '@/ui/RegionPicker';
import styles from './Settings.module.css';

export default function SettingsPage() {
  const { t } = useTranslation();

  const navItems = [
    {
      href: '/settings/theme',
      labelKey: 'settings.theme' as const,
      descriptionKey: 'settings.themeDescription' as const,
    },
    {
      href: '/settings/shortcuts',
      labelKey: 'settings.shortcuts' as const,
      descriptionKey: 'settings.shortcutsDescription' as const,
    },
    {
      href: '/settings/export',
      labelKey: 'settings.export' as const,
      descriptionKey: 'settings.exportDescription' as const,
    },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.title}>{t('settings.title')}</h1>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('settings.language')}</h2>
          <p className={styles.sectionDescription}>
            {t('settings.languageDescription')}
          </p>
          <LanguagePicker />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('settings.region')}</h2>
          <p className={styles.sectionDescription}>
            {t('settings.regionDescription')}
          </p>
          <RegionPicker />
        </section>

        <nav className={styles.nav}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`group ${styles.linkItem}`}
            >
              <div>
                <h2 className="text-lg font-medium group-hover:text-accent transition-colors">
                  {t(item.labelKey)}
                </h2>
                <p className="text-sm text-ink-secondary mt-1">
                  {t(item.descriptionKey)}
                </p>
              </div>
              <div className="text-ink-tertiary group-hover:text-accent transition-colors">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </div>
            </Link>
          ))}
        </nav>

        <footer className={styles.footer}>
          <div className={styles.footerRow}>
            <span>
              {t('common.version')} {process.env.appVersion}
            </span>
            <span>
              © {new Date().getFullYear()} {t('common.appName')}
            </span>
          </div>
          <div className={styles.author}>
            <span>{t('common.madeBy')}</span>
            <Link
              href="https://sraj.me/"
              target="_blank"
              rel="noopener"
              className={styles.authorLink}
            >
              {t('common.author')}
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
