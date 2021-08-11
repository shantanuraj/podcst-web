import Link from 'next/link';
import React, { Fragment, useCallback, useRef } from 'react';
import { Search } from '../Search';
import MenuIcon from '../icons/svg/MenuIcon';

import styles from './Header.module.css';
import BackIcon from '../icons/svg/BackIcon';
import { shortcuts } from '../../shared/keyboard/shortcuts';
import { useKeydown } from '../../shared/keyboard/useKeydown';

export function Header() {
  const drawerRef = useRef<HTMLDivElement | null>(null);

  const onHeaderClick = useCallback(() => toggleDrawer(drawerRef.current), []);
  const onCloseDrawer = useCallback(() => closeDrawer(drawerRef.current), []);
  useKeydown(shortcuts.drawer, onHeaderClick);

  return (
    <Fragment>
      <header className={styles.header}>
        <button role="button" aria-label="Toggle drawer" onClick={onHeaderClick}>
          <MenuIcon />
          <span className={styles.title}>Podcst</span>
        </button>
        <Search />
      </header>
      <nav ref={drawerRef} onClick={onCloseDrawer} className={styles.drawer}>
        <button role="button" aria-label="Close drawer" onClick={onCloseDrawer}>
          <BackIcon />
        </button>
        <ul>
          <li>
            <Link href="/feed/top">Top</Link>
          </li>
          <li>
            <Link href="/subs">Subscriptions</Link>
          </li>
          <li>
            <Link href="/recents">Recents</Link>
          </li>
          <li>
            <Link href="/settings">Settings</Link>
          </li>
        </ul>
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
