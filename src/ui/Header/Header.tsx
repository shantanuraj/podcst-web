'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef } from 'react';
import { Icon } from '@/ui/icons/svg/Icon';
import { Search } from '@/ui/Search';

import styles from './Header.module.css';

export function Header() {
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  const onToggleDrawer = useCallback(() => {
    if (!drawerRef.current) return;
    drawerRef.current.dataset.open = drawerRef.current.dataset.open === 'open' ? '' : 'open';
  }, []);

  const onCloseDrawer = useCallback(() => {
    if (!drawerRef.current) return;
    drawerRef.current.dataset.open = '';
  }, []);

  useEffect(() => {
    const closeOnClickOutside = (event: MouseEvent) => {
      if (
        menuButtonRef.current?.contains(event.target as Node) ||
        drawerRef.current?.contains(event.target as Node) ||
        drawerRef.current?.dataset.open !== 'open'
      )
        return;
      drawerRef.current.dataset.open = '';
    };
    document.addEventListener('click', closeOnClickOutside);
    return () => document.removeEventListener('click', closeOnClickOutside);
  }, []);

  return (
    <Fragment>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.masthead}>
            <Link href="/feed/top" className={styles.title}>
              Podcst
            </Link>
            <nav className={styles.nav}>
              <Link href="/feed/top">Discover</Link>
              <Link href="/subs">Library</Link>
              <Link href="/queue">Queue</Link>
              <Link href="/recents">Recent</Link>
            </nav>
          </div>
          <div className={styles.actions}>
            <Search />
            <button
              aria-label="Menu"
              onClick={onToggleDrawer}
              ref={menuButtonRef}
              className={styles.hamburgerIcon}
            >
              <Icon icon="menu" />
            </button>
          </div>
        </div>
      </header>
      <nav ref={drawerRef} className={styles.drawer}>
        <button aria-label="Close" onClick={onCloseDrawer} className={styles.closeNav}>
          <Icon icon="back" />
        </button>
        <Link href="/feed/top" onClick={onCloseDrawer}>
          Discover
        </Link>
        <Link href="/subs" onClick={onCloseDrawer}>
          Library
        </Link>
        <Link href="/queue" onClick={onCloseDrawer}>
          Queue
        </Link>
        <Link href="/recents" onClick={onCloseDrawer}>
          Recent
        </Link>
        <div className={styles.navGroup}>
          <h6>Settings</h6>
          <ul>
            <li>
              <Link href="/settings" onClick={onCloseDrawer}>
                Preferences
              </Link>
            </li>
          </ul>
        </div>
      </nav>
    </Fragment>
  );
}
