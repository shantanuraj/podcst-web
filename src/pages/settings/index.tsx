import { NextPage } from 'next';
import Link from 'next/link';
import * as React from 'react';

import styles from './Settings.module.css';

const SettingsPage: NextPage = () => {
  return (
    <nav className={styles.container}>
      <Link href="/settings/theme">
        <a>Change Theme</a>
      </Link>
      <Link href="/settings/shortcuts">
        <a>Shortcuts</a>
      </Link>
      <Link href="#about">
        <a>Version: {process.env.appVersion}</a>
      </Link>
    </nav>
  );
};

export default SettingsPage;
