import Link from 'next/link';
import { Fragment, useRef } from 'react';
import { Search } from '../Search';
import MenuIcon from '../icons/svg/MenuIcon';

import styles from './Header.module.css';
import BackIcon from '../icons/svg/BackIcon';

export function Header() {
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const onHeaderClick = () => toggleDrawer(drawerRef.current);
  const onCloseDrawer = () => closeDrawer(drawerRef.current);

  return (
    <Fragment>
      <header className={styles.header}>
        <button role="button" aria-label="Toggle drawer" onClick={onHeaderClick}>
          <MenuIcon />
          <span className={styles.title}>Podcst</span>
        </button>
        <Search />
      </header>
      <nav ref={drawerRef} className={styles.drawer}>
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
};

const closeDrawer = (drawer: HTMLDivElement | null) => {
  if (!drawer) return;
  drawer.dataset.open = '';
};
