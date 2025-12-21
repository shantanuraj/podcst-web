'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/ui/icons/svg/Icon';
import { Search } from '@/ui/Search/Search';

import styles from './SiteHeader.module.css';

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <Link href="/feed/top" className={styles.wordmark}>
          Podcst
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
            Discover
          </Link>
          <Link
            href="/subs"
            className={styles.navLink}
            data-active={pathname === '/subs' || pathname === '/recents'}
          >
            Library
          </Link>
        </nav>
        <div className={styles.actions}>
          <Search />
          <Link href="/settings" className={styles.iconLink} title="Settings">
            <Icon icon="settings" size={20} />
          </Link>
        </div>
      </div>
    </header>
  );
}
