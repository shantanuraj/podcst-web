import Link from 'next/link';
import type { Metadata } from 'next';
import styles from './NotFound.module.css';

export const metadata: Metadata = {
  title: '404 - Page Not Found | Podcst',
  description: 'The page you are looking for could not be found.',
};

export default function NotFound() {
  return (
    <div className={styles.container}>
      <div className={styles.icon}>
        <svg
          width="80"
          height="80"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="8" y1="22" x2="16" y2="22" />
          <line x1="2" y1="2" x2="22" y2="22" style={{ opacity: 0.4 }} />
        </svg>
      </div>
      <h1 className={styles.title}>Lost in the airwaves</h1>
      <p className={styles.text}>
        The page you&apos;re looking for doesn&apos;t exist or has been moved to a different frequency.
      </p>
      <div className={styles.actions}>
        <Link href="/" className={styles.homeButton}>
          Browse popular podcasts
        </Link>
      </div>
    </div>
  );
}

