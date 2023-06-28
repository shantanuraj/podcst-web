'use client';

import Link from 'next/link';
import React, { Fragment, useCallback, useEffect, useRef } from 'react';
import { Search } from '../Search';

import { Icon } from '../icons/svg/Icon';

import styles from './Header.module.css';

export function Header() {
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  const onHeaderClick = useCallback(() => toggleDrawer(drawerRef.current), []);
  const onCloseDrawer = useCallback(() => closeDrawer(drawerRef.current), []);

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
    return () => {
      document.removeEventListener('click', closeOnClickOutside);
    };
  }, []);

  return (
    <Fragment>
      <header className={styles.header}>
        <button
          role="button"
          aria-label="Toggle drawer"
          onClick={onHeaderClick}
          ref={menuButtonRef}
          className={styles.hamburgerIcon}
        >
          <Icon icon="menu" />
        </button>
        <span className={styles.title}>Podcst</span>
        <Search />
      </header>
      <nav ref={drawerRef} onClick={onCloseDrawer} className={styles.drawer}>
        <button
          role="button"
          aria-label="Close drawer"
          onClick={onCloseDrawer}
          className={styles.closeNav}
        >
          <Icon icon="back" />
        </button>
        <Link href="/feed/top">Home</Link>
        <div className={styles.navGroup}>
          <h6>Your Library</h6>
          <ul>
            <li>
              <Link href="/subs">Subscriptions</Link>
            </li>
            <li>
              <Link href="/queue">Queue</Link>
            </li>
            <li>
              <Link href="/recents">Recent Episodes</Link>
            </li>
          </ul>
        </div>
        <Link href="/settings">Settings</Link>
      </nav>
    </Fragment>
  );
}

const toggleDrawer = (drawer: HTMLDivElement | null) => {
  if (!drawer) return;
  drawer.dataset.open = drawer.dataset.open === 'open' ? '' : 'open';
  if (drawer.dataset.open === 'open') drawer.focus();
};

const closeDrawer = (drawer: HTMLDivElement | null) => {
  if (!drawer) return;
  drawer.dataset.open = '';
};
