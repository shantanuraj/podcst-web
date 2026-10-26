import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../account/Account.module.css';

export const metadata: Metadata = {
  title: 'Account deletion',
  alternates: { canonical: '/privacy' },
};

export default function AccountPrivacyPage() {
  return (
    <main
      className={styles.page}
      style={{ gridTemplateColumns: 'minmax(0, 760px)' }}
    >
      <section id="deletion" className={styles.deletion}>
        <h1 className={styles.sectionTitle}>Podcst account deletion</h1>
        <p>
          You can{' '}
          <Link href="/account#delete">
            delete your account in account settings
          </Link>
          , or use Delete account in the iOS or Android app’s settings. Sign in,
          request an emailed deletion code and confirm permanent deletion. You
          can cancel before submitting the request.
        </p>
        <p>
          Deletion removes your account, sign-in credentials, follows, listening
          history, Starred episodes, preferences and private feeds from the
          active service. Public podcast listings remain available. Deletion
          does not cancel a publisher’s subscription or revoke a private RSS
          token at its source.
        </p>
        <p>
          If completion cannot be confirmed immediately, your request remains
          pending. Use Check deletion status to retry. We keep a status receipt
          for seven days. A missing or expired receipt does not prove deletion;
          the app preserves your saved data when the outcome is unknown.
        </p>
        <p>
          After confirmation, the requesting browser or device removes saved
          data belonging to that account. If cleanup fails, it remains
          incomplete until you retry. Deletion cannot instantly remove data from
          disconnected devices, system caches, publisher services or copies you
          exported. Signing out alone retains pending account data on that
          device.
        </p>
      </section>
    </main>
  );
}
