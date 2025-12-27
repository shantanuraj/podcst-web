'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import React from 'react';
import { useTranslation } from '@/shared/i18n';
import { useSession, useLogout } from '@/shared/auth/useAuth';
import {
  type IThemeInfo,
  type Scheme,
  type ThemeConfig,
  themes,
  useTheme,
} from '@/shared/theme/useTheme';
import type { ThemeMode } from '@/types';
import { shortcuts } from '@/shared/keyboard/shortcuts';
import {
  type SubscriptionsState,
  useSubscriptions,
} from '@/shared/subscriptions/useSubscriptions';
import {
  useServerSubscriptions,
  useSyncToCloud,
} from '@/shared/subscriptions/useServerSubscriptions';
import { LanguagePicker } from '@/ui/LanguagePicker';
import { RegionPicker } from '@/ui/RegionPicker';

import styles from './Profile.module.css';

export default function ProfilePage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: user, isLoading } = useSession();
  const logout = useLogout();

  if (isLoading) return null;

  if (!user) {
    router.replace('/settings');
    return null;
  }

  const handleSignOut = async () => {
    await logout.mutateAsync();
    router.push('/');
  };

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.title}>{t('profile.title')}</h1>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('profile.account')}</h2>
          <div className={styles.accountCard}>
            <div className={styles.avatar}>
              {user.email.charAt(0).toUpperCase()}
            </div>
            <div className={styles.accountInfo}>
              <span className={styles.email}>{user.email}</span>
              {user.name && <span className={styles.name}>{user.name}</span>}
            </div>
            <button onClick={handleSignOut} className={styles.signOutButton}>
              {t('nav.signOut')}
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('settings.language')}</h2>
          <LanguagePicker />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('settings.region')}</h2>
          <RegionPicker />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('settings.theme')}</h2>
          <ThemeSelector />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('settings.shortcuts')}</h2>
          <ShortcutsList />
        </section>

        <SyncSubscriptions />

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('settings.export')}</h2>
          <ExportSubscriptions />
        </section>

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
              Shantanu Raj
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ThemeSelector() {
  const { scheme, theme, changeTheme: setTheme } = useTheme();

  const handleChange = (e: React.FormEvent) => {
    const config = (e.target as HTMLInputElement).value as ThemeConfig;
    const [newScheme, newTheme] = config.split('/') as [Scheme, ThemeMode];
    setTheme(newScheme, newTheme);
  };

  const currentTheme = `${scheme}/${theme}` as const;

  return (
    <form onChange={handleChange} className={styles.themeGrid}>
      {themes.map((item) => (
        <ThemeOption
          key={`${item.scheme}/${item.theme}`}
          {...item}
          currentTheme={currentTheme}
        />
      ))}
    </form>
  );
}

interface ThemeOptionProps extends IThemeInfo {
  currentTheme: ThemeConfig;
}

function ThemeOption({ currentTheme, scheme, theme }: ThemeOptionProps) {
  const config: ThemeConfig = `${scheme}/${theme}`;
  const id = `theme-${config}`;
  const isSelected = config === currentTheme;

  return (
    <label
      htmlFor={id}
      className={styles.themeOption}
      data-selected={isSelected}
    >
      <input
        type="radio"
        id={id}
        name="theme"
        checked={isSelected}
        onChange={() => {}}
        value={config}
        className="sr-only"
      />
      <span className={styles.themeLabel}>
        {scheme.charAt(0).toUpperCase() + scheme.slice(1)}{' '}
        {theme === 'dark' ? 'Dark' : 'Light'}
      </span>
    </label>
  );
}

function ShortcutsList() {
  const { t } = useTranslation();
  const shortcutKeys: Record<string, keyof typeof shortcuts> = {
    'shortcuts.home': 'home',
    'shortcuts.subscriptions': 'subscriptions',
    'shortcuts.recents': 'recents',
    'shortcuts.settings': 'settings',
    'shortcuts.search': 'search',
    'shortcuts.toggleTheme': 'theme',
    'shortcuts.previousTheme': 'previousTheme',
    'shortcuts.showEpisodeInfo': 'info',
    'shortcuts.queue': 'queue',
    'shortcuts.playPause': 'togglePlayback',
    'shortcuts.seekBack': 'seekBack',
    'shortcuts.seekAhead': 'seekAhead',
    'shortcuts.seekToPercent': 'seekTo',
    'shortcuts.nextEpisode': 'nextEpisode',
    'shortcuts.previousEpisode': 'previousEpisode',
    'shortcuts.increaseSpeed': 'bumpRate',
    'shortcuts.decreaseSpeed': 'decreaseRate',
    'shortcuts.toggleMute': 'mute',
    'shortcuts.showShortcuts': 'shortcuts',
  };

  return (
    <div className={styles.shortcutsList}>
      {Object.entries(shortcutKeys).map(([messageKey, shortcutKey]) => (
        <div key={shortcutKey} className={styles.shortcutRow}>
          <span>{t(messageKey as keyof typeof t)}</span>
          <kbd className={styles.kbd}>{shortcuts[shortcutKey].displayKey}</kbd>
        </div>
      ))}
    </div>
  );
}

function SyncSubscriptions() {
  const { t } = useTranslation();
  const localSubs = useSubscriptions((state: SubscriptionsState) => state.subs);
  const clearSubs = useSubscriptions(
    (state: SubscriptionsState) => state.addSubscriptions,
  );
  const localFeedUrls = React.useMemo(
    () => Object.keys(localSubs),
    [localSubs],
  );

  const syncToCloud = useSyncToCloud();

  if (localFeedUrls.length === 0) return null;

  const handleSync = async () => {
    await syncToCloud.mutateAsync(localFeedUrls);
    clearSubs([]);
  };

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{t('profile.subscriptions')}</h2>
      <div className={styles.syncSection}>
        <p className={styles.syncDescription}>
          {t('profile.syncDescription', { count: localFeedUrls.length })}
        </p>
        <button
          onClick={handleSync}
          disabled={syncToCloud.isPending}
          className={styles.syncButton}
        >
          {syncToCloud.isPending
            ? t('profile.importing')
            : t('profile.importFromDevice')}
        </button>
      </div>
    </section>
  );
}

function ExportSubscriptions() {
  const { t } = useTranslation();
  const { data: serverSubs } = useServerSubscriptions();

  const subs = React.useMemo(
    () =>
      (serverSubs || []).map((sub) => ({
        title: sub.title,
        feed: sub.feed,
      })),
    [serverSubs],
  );

  const exportOPML = React.useCallback(() => {
    const doc = document.implementation.createDocument('', '', null);

    const opml = doc.createElement('opml');
    opml.setAttribute('version', '1.0');

    const head = doc.createElement('head');
    const title = doc.createElement('title');
    title.textContent = 'Podcst Subscriptions';
    head.appendChild(title);
    opml.appendChild(head);

    const body = doc.createElement('body');
    opml.appendChild(body);
    const feeds = doc.createElement('outline');
    feeds.setAttribute('text', 'feeds');
    body.appendChild(feeds);

    subs.forEach((sub) => {
      const outline = doc.createElement('outline');
      outline.setAttribute('text', sub.title);
      outline.setAttribute('xmlUrl', sub.feed);
      outline.setAttribute('type', 'rss');
      feeds.appendChild(outline);
    });

    let xmlStr = '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n';
    xmlStr += new XMLSerializer().serializeToString(opml);

    const blob = new Blob([xmlStr], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'podcst-subscriptions.opml';
    link.click();
  }, [subs]);

  return (
    <div className={styles.exportSection}>
      <p className={styles.exportDescription}>
        {t('settings.exportDescriptionLong')}
      </p>
      <button onClick={exportOPML} className={styles.exportButton}>
        {t('profile.downloadOPML')}
      </button>
      <span className={styles.exportCount}>
        {subs.length} {subs.length === 1 ? 'podcast' : 'podcasts'}
      </span>
    </div>
  );
}
