import Link from 'next/link';
import styles from './Settings.module.css';

const SettingsPage = () => {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.title}>Settings</h1>
        </header>

        <nav className={styles.nav}>
          {[
            {
              href: '/settings/theme',
              label: 'Theme',
              description: 'Customize the appearance of Podcst',
            },
            {
              href: '/settings/shortcuts',
              label: 'Keyboard Shortcuts',
              description: 'View and manage shortcuts',
            },
            {
              href: '/settings/export',
              label: 'Export Subscriptions',
              description: 'Download your library as an OPML file',
            },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`group ${styles.linkItem}`}
            >
              <div>
                <h2 className="text-lg font-medium group-hover:text-accent transition-colors">
                  {item.label}
                </h2>
                <p className="text-sm text-ink-secondary mt-1">
                  {item.description}
                </p>
              </div>
              <div className="text-ink-tertiary group-hover:text-accent transition-colors">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </div>
            </Link>
          ))}
        </nav>

        <footer className={styles.footer}>
          <div className={styles.footerRow}>
            <span>Version {process.env.appVersion}</span>
            <span>© {new Date().getFullYear()} Podcst</span>
          </div>
          <div className={styles.author}>
            <span>Made by</span>
            <Link
              href="https://sraj.me/"
              target="_blank"
              rel="noopener"
              className={styles.authorLink}
            >
              Shantanu Raj
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default SettingsPage;
