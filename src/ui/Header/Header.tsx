import Link from 'next/link';
import React, { Fragment, useCallback, useRef } from 'react';
import { Search } from '../Search';

import { shortcuts } from '../../shared/keyboard/shortcuts';
import { useKeydown } from '../../shared/keyboard/useKeydown';
import { Icon } from '../icons/svg/Icon';

import styles from './Header.module.css';

export function Header() {
  const drawerRef = useRef<HTMLDivElement | null>(null);

  const onHeaderClick = useCallback(() => toggleDrawer(drawerRef.current), []);
  const onCloseDrawer = useCallback(() => closeDrawer(drawerRef.current), []);
  useKeydown(shortcuts.drawer, onHeaderClick);
  useKeydown(shortcuts.closeDrawer, onCloseDrawer);

  return (
    <Fragment>
      <header className={styles.header}>
        <button role="button" aria-label="Toggle drawer" onClick={onHeaderClick}>
          <Icon icon="menu" />
          <span className={styles.title}>Podcst</span>
        </button>
        <Search />
      </header>
      <nav ref={drawerRef} onClick={onCloseDrawer} className={styles.drawer}>
        <button role="button" aria-label="Close drawer" onClick={onCloseDrawer}>
          <Icon icon="back" />
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
