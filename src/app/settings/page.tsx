import Link from 'next/link';
import * as React from 'react';

import styles from './Settings.module.css';

const SettingsPage = () => {
  return (
    <nav className={styles.container}>
      <Link href="/settings/theme">Change Theme</Link>
      <Link href="/settings/shortcuts">Shortcuts</Link>
      <Link href="/settings/export">Export</Link>
      <Link href="#version">Version: {process.env.appVersion}</Link>
    </nav>
  );
};

export default SettingsPage;
