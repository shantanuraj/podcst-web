'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/shared/auth/useAuth';
import { useTranslation } from '@/shared/i18n';
import { Icon } from '@/ui/icons/svg/Icon';
import { PageLink } from '@/ui/PageLink/PageLink';
import { Search } from '@/ui/Search/Search';

import styles from './SiteHeader.module.css';

export function SiteHeader() {
  const pathname = usePathname();
  const { data: user } = useSession();
  const { t } = useTranslation();

  const tabs = [
    {
      href: '/feed/top',
      label: t('nav.discover'),
      active:
        pathname === '/feed/top' ||
        /^\/[a-z]{2}\/feed\//.test(pathname) ||
        pathname.startsWith('/episodes/'),
    },
    {
      href: '/library',
      label: t('nav.library'),
      active: pathname === '/library',
    },
    { href: '/queue', label: t('nav.queue'), active: pathname === '/queue' },
  ];

  return (
    <header className={styles.header}>
      <div className={styles.start}>
        <PageLink
          href="/feed/top"
          className={styles.wordmark}
          loading="podcasts"
        >
          {t('common.appName')}
        </PageLink>
        <nav className={styles.nav}>
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={styles.tab}
              aria-current={tab.active ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className={styles.search}>
        <Search />
      </div>
      <div className={styles.end}>
        {user ? (
          <Link
            href="/account"
            className={styles.avatar}
            aria-label={t('nav.account')}
            title={user.email}
            aria-current={pathname === '/account' ? 'page' : undefined}
          >
            {user.email.charAt(0).toUpperCase()}
          </Link>
        ) : (
          <>
            <Link
              href="/account"
              className={styles.settings}
              aria-current={pathname === '/account' ? 'page' : undefined}
              aria-label={t('nav.settings')}
            >
              <Icon icon="settings" size={20} />
              <span>{t('nav.settings')}</span>
            </Link>
            <Link href="/auth" className={styles.signIn}>
              {t('nav.signIn')}
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
