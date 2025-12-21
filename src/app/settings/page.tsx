import Link from 'next/link';

import styles from './Settings.module.css';

const SettingsPage = () => {
  return (
    <nav className={styles.container}>
      <Link href="/settings/theme">Change Theme</Link>
      <Link href="/settings/shortcuts">Shortcuts</Link>
      <Link href="/settings/export">Export</Link>
      <Link href="#version">Version: {process.env.appVersion}</Link>
      <div className={styles.footer}>
        <span> © {new Date().getFullYear()}</span>

        <div>
          <span>Made by </span>
          <Link href="https://sraj.me" target="_blank" rel="noopener noreferrer">
            Shantanu Raj
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default SettingsPage;
