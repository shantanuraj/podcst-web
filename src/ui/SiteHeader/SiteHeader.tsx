'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/shared/auth/useAuth';
import { useTranslation } from '@/shared/i18n';
import { Icon } from '@/ui/icons/svg/Icon';
import { LocaleSwitcher } from '@/ui/LocaleSwitcher';
import { Search } from '@/ui/Search/Search';

import styles from './SiteHeader.module.css';

export function SiteHeader() {
  const pathname = usePathname();
  const { data: user } = useSession();
  const { t } = useTranslation();

  const libraryHref = user ? '/profile/subscriptions' : '/subs';
  const isLibraryActive =
    pathname === '/subs' ||
    pathname === '/recents' ||
    pathname === '/profile/subscriptions';

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <Link href="/feed/top" className={styles.wordmark}>
          {t('common.appName')}
        </Link>
        <nav className={styles.nav}>
          <Link
            href="/feed/top"
            className={styles.navLink}
            data-active={
              pathname === '/feed/top' ||
              pathname.startsWith('/us/') ||
              pathname.startsWith('/episodes/')
            }
          >
            {t('nav.discover')}
          </Link>
          <Link
            href={libraryHref}
            className={styles.navLink}
            data-active={isLibraryActive}
          >
            {t('nav.library')}
          </Link>
        </nav>
        <div className={styles.actions}>
          <Search />
          <LocaleSwitcher />
          {user ? (
            <Link
              href="/profile"
              className={styles.iconLink}
              title={user.email}
            >
              <Icon icon="user" size={20} />
            </Link>
          ) : (
            <>
              <Link
                href="/settings"
                className={styles.iconLink}
                title={t('nav.settings')}
              >
                <Icon icon="settings" size={20} />
              </Link>
              <Link href="/auth" className={styles.authLink}>
                {t('nav.signIn')}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
