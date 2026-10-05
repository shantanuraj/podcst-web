'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { OpmlImport } from '@/components/OpmlImport/OpmlImport';
import {
  type AccountPasskey,
  useAccountDetails,
  useRemovePasskey,
  useSavePreferences,
} from '@/data/account';
import { i18n, type Locale } from '@/i18.conf';
import { type Language, languageNames, localeForLanguage } from '@/messages';
import { useLogout, useRegister, useSession } from '@/shared/auth/useAuth';
import { type TranslationKey, useTranslation } from '@/shared/i18n';
import { shortcuts } from '@/shared/keyboard/shortcuts';
import { downloadOpml } from '@/shared/opml';
import { SpeedPresets } from '@/shared/player/Speed';
import { defaultPreferences, type Preferences } from '@/shared/preferences';
import { readRegion, regionFromLanguages, writeRegion } from '@/shared/region';
import {
  useServerSubscriptions,
  useSyncToCloud,
} from '@/shared/subscriptions/useServerSubscriptions';
import { useSubscriptions } from '@/shared/subscriptions/useSubscriptions';
import { type ThemePreference, themePreferences } from '@/shared/theme/theme';
import { useTheme, useThemeStore } from '@/shared/theme/useTheme';
import { useHydrated } from '@/shared/useHydrated';
import styles from './Account.module.css';

const sections = [
  ['profile', 'account.profile'],
  ['playback', 'account.playback'],
  ['appearance', 'account.appearance'],
  ['region', 'account.region'],
  ['library', 'account.library'],
  ['shortcuts', 'account.shortcuts'],
] as const satisfies readonly (readonly [string, TranslationKey])[];

export default function AccountPage() {
  const { t } = useTranslation();
  const { data: user, isLoading } = useSession();
  const active = useActiveSection();

  return (
    <div className={styles.page}>
      <nav className={styles.index} aria-label={t('account.title')}>
        {sections.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={active === id ? 'true' : undefined}
          >
            {t(label)}
          </a>
        ))}
        {user && <SignOut className={styles.signOut} />}
      </nav>
      <div>
        <h1 className={styles.title}>{t('account.title')}</h1>
        <section id="profile" className={styles.section}>
          {isLoading ? null : user ? <Profile email={user.email} /> : <Guest />}
        </section>
        <Section id="playback" title={t('account.playback')}>
          <Playback signedIn={!!user} />
        </Section>
        <Section id="appearance" title={t('account.appearance')}>
          <Appearance />
        </Section>
        <Section id="region" title={t('account.region')}>
          <Region />
        </Section>
        <Section id="library" title={t('account.library')}>
          <Library signedIn={!!user} />
        </Section>
        <Section id="shortcuts" title={t('account.shortcuts')}>
          <Shortcuts />
        </Section>
        <footer className={styles.footer}>
          Podcst {process.env.appVersion} ·{' '}
          <Link href="https://sraj.me/" target="_blank" rel="noopener">
            {t('common.madeBy')} {t('common.author')}
          </Link>
        </footer>
      </div>
    </div>
  );
}

function SignOut({ className }: { className: string }) {
  const { t } = useTranslation();
  const logout = useLogout();
  const router = useRouter();
  return (
    <button
      type="button"
      className={className}
      disabled={logout.isPending}
      onClick={async () => {
        await logout.mutateAsync();
        router.push('/feed/top');
      }}
    >
      {t('nav.signOut')}
    </button>
  );
}

function useActiveSection() {
  const [active, setActive] = useState<string>(sections[0][0]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    for (const [id] of sections) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);
  return active;
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.label}>{label}</div>
      <div className={styles.control}>
        {children}
        {description && <p className={styles.description}>{description}</p>}
      </div>
    </div>
  );
}

function useDateFormat(options: Intl.DateTimeFormatOptions) {
  const { language } = useTranslation();
  return useMemo(
    () => new Intl.DateTimeFormat(localeForLanguage[language], options),
    [language, options],
  );
}

const monthYear: Intl.DateTimeFormatOptions = {
  month: 'long',
  year: 'numeric',
};
const shortDate: Intl.DateTimeFormatOptions = {
  month: 'short',
  year: 'numeric',
};
const dayMonth: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

function Profile({ email }: { email: string }) {
  const { t } = useTranslation();
  const { data: account } = useAccountDetails();
  const { data: subscriptions } = useServerSubscriptions();
  const memberSince = useDateFormat(monthYear);
  return (
    <>
      <div className={styles.profile}>
        <div className={styles.avatar} aria-hidden="true">
          {email.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className={styles.email}>{email}</div>
          <div className={styles.meta}>
            {[
              account?.createdAt &&
                t('account.memberSince', {
                  date: memberSince.format(new Date(account.createdAt)),
                }),
              subscriptions &&
                t('account.subscriptionCount', { count: subscriptions.length }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <SignOut className={styles.signOutInline} />
      </div>
      <Row label={t('account.passkeys')}>
        <Passkeys email={email} passkeys={account?.passkeys} />
      </Row>
    </>
  );
}

function Passkeys({
  email,
  passkeys,
}: {
  email: string;
  passkeys: AccountPasskey[] | undefined;
}) {
  const { t } = useTranslation();
  const register = useRegister();
  const remove = useRemovePasskey();
  const added = useDateFormat(shortDate);
  const used = useDateFormat(dayMonth);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toDateString();

  return (
    <div className={styles.passkeys}>
      {passkeys?.length === 0 && (
        <p className={styles.description}>{t('account.noPasskeys')}</p>
      )}
      {passkeys?.map((passkey) => (
        <div key={passkey.id} className={styles.passkey}>
          <div>
            <div className={styles.passkeyName}>
              {passkey.provider ?? t('account.passkey')}
            </div>
            <div className={styles.meta}>
              {[
                t('account.passkeyAdded', {
                  date: added.format(new Date(passkey.createdAt)),
                }),
                passkey.lastUsedAt &&
                  (new Date(passkey.lastUsedAt).toDateString() === today
                    ? t('account.passkeyUsedToday')
                    : t('account.passkeyUsed', {
                        date: used.format(new Date(passkey.lastUsedAt)),
                      })),
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <button
            type="button"
            className={styles.quiet}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(t('account.removePasskeyConfirm')))
                remove.mutate(passkey.id);
            }}
          >
            {t('account.removePasskey')}
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button
        type="button"
        className={styles.outline}
        disabled={register.isPending}
        onClick={async () => {
          setError(null);
          try {
            await register.mutateAsync(email);
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : t('common.error'),
            );
          }
        }}
      >
        {register.isPending ? t('auth.settingUp') : t('account.addPasskey')}
      </button>
    </div>
  );
}

function Guest() {
  const { t } = useTranslation();
  return (
    <div className={styles.guest}>
      <div>
        <div className={styles.email}>{t('account.guestTitle')}</div>
        <p className={styles.meta}>{t('account.guestBody')}</p>
      </div>
      <Link href="/auth" className={styles.primary}>
        {t('nav.signIn')}
      </Link>
    </div>
  );
}

function Playback({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  const { data } = useAccountDetails();
  const save = useSavePreferences();
  const preferences = data?.preferences ?? defaultPreferences;
  const toggle = (key: 'trimSilence' | 'volumeBoost') => () =>
    save.mutate({ ...preferences, [key]: !preferences[key] } as Preferences);

  return (
    <>
      <Row
        label={t('account.defaultSpeed')}
        description={
          signedIn ? t('account.speedSynced') : t('account.speedLocal')
        }
      >
        <SpeedPresets />
      </Row>
      {signedIn && (
        <>
          {(
            [
              [
                'trimSilence',
                'account.trimSilence',
                'account.trimSilenceDescription',
              ],
              [
                'volumeBoost',
                'account.volumeBoost',
                'account.volumeBoostDescription',
              ],
            ] as const
          ).map(([key, label, description]) => (
            <Row key={key} label={t(label)} description={t(description)}>
              <button
                type="button"
                role="switch"
                aria-checked={preferences[key]}
                aria-label={t(label)}
                className={styles.switch}
                disabled={!data}
                onClick={toggle(key)}
              />
            </Row>
          ))}
          <p className={styles.note}>{t('account.effectsNote')}</p>
        </>
      )}
    </>
  );
}

function Appearance() {
  const { t } = useTranslation();
  const { preference } = useTheme();
  const hydrated = useHydrated();
  const labels: Record<ThemePreference, TranslationKey> = {
    system: 'account.themeSystem',
    light: 'account.themeLight',
    dark: 'account.themeDark',
  };
  return (
    <Row label={t('account.theme')}>
      <fieldset className={styles.segmented} aria-label={t('account.theme')}>
        {themePreferences.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={hydrated && preference === option}
            onClick={() => useThemeStore.getState().setPreference(option)}
          >
            {t(labels[option])}
          </button>
        ))}
      </fieldset>
    </Row>
  );
}

function Region() {
  const { t, language, setLanguage } = useTranslation();
  const router = useRouter();
  const [region, setRegion] = useState<Locale | null>(null);
  const [detected, setDetected] = useState<Locale | null>(null);

  useEffect(() => {
    const device = regionFromLanguages(navigator.languages);
    setDetected(device);
    setRegion(readRegion() ?? device ?? i18n.defaultLocale);
  }, []);

  const regions = useMemo(
    () =>
      [...i18n.locales].sort((a, b) =>
        t(`regions.${a}`).localeCompare(t(`regions.${b}`)),
      ),
    [t],
  );

  return (
    <>
      <Row
        label={t('account.chartsRegion')}
        description={
          region && region === detected ? t('account.detected') : undefined
        }
      >
        <select
          className={styles.select}
          value={region ?? ''}
          aria-label={t('account.chartsRegion')}
          onChange={(event) => {
            const next = event.currentTarget.value as Locale;
            writeRegion(next);
            setRegion(next);
          }}
        >
          {regions.map((code) => (
            <option key={code} value={code}>
              {t(`regions.${code}`)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('account.language')}>
        <select
          className={styles.select}
          value={language}
          aria-label={t('account.language')}
          onChange={(event) => {
            setLanguage(event.currentTarget.value as Language);
            router.refresh();
          }}
        >
          {(Object.keys(languageNames) as Language[]).map((code) => (
            <option key={code} value={code}>
              {languageNames[code].native}
            </option>
          ))}
        </select>
      </Row>
    </>
  );
}

function Library({ signedIn }: { signedIn: boolean }) {
  const { t } = useTranslation();
  const local = useSubscriptions((state) => state.subs);
  const { data: remote } = useServerSubscriptions();
  const feeds = useMemo(
    () =>
      (signedIn ? (remote ?? []) : Object.values(local)).map(
        ({ title, feed }) => ({ title, feed }),
      ),
    [signedIn, remote, local],
  );
  const sync = useSyncToCloud();
  const deviceFeeds = Object.keys(local);
  return (
    <>
      <Row label={t('account.opml')} description={t('account.opmlDescription')}>
        <div className={styles.actions}>
          <OpmlImport />
          <button
            type="button"
            className={styles.outline}
            disabled={!feeds.length}
            onClick={() => downloadOpml(feeds)}
          >
            {t('account.exportOpml', { count: feeds.length })}
          </button>
        </div>
      </Row>
      {signedIn && deviceFeeds.length > 0 && (
        <Row
          label={t('account.thisDevice')}
          description={
            sync.data
              ? t('account.importResult', {
                  imported: sync.data.succeeded,
                  failed: sync.data.failed,
                })
              : t('account.thisDeviceDescription', {
                  count: deviceFeeds.length,
                })
          }
        >
          <button
            type="button"
            className={styles.outline}
            disabled={sync.isPending}
            onClick={() => sync.mutate(deviceFeeds)}
          >
            {sync.isPending
              ? t('account.importing')
              : t('account.importDevice')}
          </button>
        </Row>
      )}
    </>
  );
}

const shortcutLabels = {
  home: 'shortcuts.home',
  subscriptions: 'shortcuts.subscriptions',
  settings: 'shortcuts.settings',
  search: 'shortcuts.search',
  theme: 'shortcuts.toggleTheme',
  info: 'shortcuts.showEpisodeInfo',
  queue: 'shortcuts.queue',
  togglePlayback: 'shortcuts.playPause',
  seekBack: 'shortcuts.seekBack',
  seekAhead: 'shortcuts.seekAhead',
  seekTo: 'shortcuts.seekToPercent',
  nextEpisode: 'shortcuts.nextEpisode',
  previousEpisode: 'shortcuts.previousEpisode',
  bumpRate: 'shortcuts.increaseSpeed',
  decreaseRate: 'shortcuts.decreaseSpeed',
  mute: 'shortcuts.toggleMute',
  shortcuts: 'shortcuts.showShortcuts',
} as const satisfies Record<keyof typeof shortcuts, TranslationKey>;

function Shortcuts() {
  const { t } = useTranslation();
  return (
    <dl className={styles.shortcuts}>
      {(Object.keys(shortcutLabels) as (keyof typeof shortcutLabels)[]).map(
        (key) => (
          <div key={key}>
            <dt>{t(shortcutLabels[key])}</dt>
            <dd>
              <kbd>{shortcuts[key].displayKey}</kbd>
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}
