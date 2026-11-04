import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './Support.module.css';

export const metadata: Metadata = {
  title: 'Contact us and support',
  description:
    'Get help with Podcst on the web, iPhone, iPad and Android. Contact us about playback, downloads, your account, or a feature you would like to see.',
  alternates: { canonical: '/support' },
};

export default function SupportPage() {
  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Podcst support</p>
        <h1 className={styles.title}>Contact us</h1>
        <p className={styles.intro}>
          A playback problem, an account question, or an idea for Podcst? We’d
          like to hear from you.
        </p>
      </header>

      <section className={styles.contact} aria-labelledby="contact-heading">
        <h2 id="contact-heading" className={styles.sectionTitle}>
          Contact Podcst
        </h2>
        <a className={styles.email} href="mailto:support@podcst.app">
          support@podcst.app
        </a>
        <p>Podcst is developed and operated by Watercooler Labs.</p>
        <p>
          For help with the web, iPhone, iPad or Android app, email us with a
          description of what happened. General feedback and feature requests
          are welcome, too.
        </p>
        <p className={styles.detail}>
          If something isn’t working, include your device, app or browser
          version, and the podcast or episode name when relevant. A screenshot
          can help us understand the problem.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="podcasts-heading">
        <h2 id="podcasts-heading" className={styles.sectionTitle}>
          About the podcasts
        </h2>
        <p>
          Podcst is a podcast player and directory. Podcasts, including news
          shows, are published by independent creators. The podcast and episode
          pages identify the show and publisher, and show the publication date
          and original show notes supplied in the podcast feed.
        </p>
        <p>
          For a question about an episode, contact its publisher through the
          podcast’s website or show notes. To report a problem with a listing in
          Podcst, use the support email above and include the podcast or episode
          link.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="account-heading">
        <h2 id="account-heading" className={styles.sectionTitle}>
          Your account and privacy
        </h2>
        <p>
          You can <Link href="/account">manage your account</Link> or{' '}
          <Link href="/account#delete">request account deletion</Link> on the
          web. Sign in with the account you want to manage.
        </p>
        <p>
          Read our <Link href="/privacy">privacy policy</Link> for details about
          your information. For privacy or deletion questions, contact{' '}
          <a href="mailto:privacy@podcst.app">privacy@podcst.app</a>.
        </p>
      </section>

      <footer className={styles.footer}>
        <Link href="/">Back to Podcst</Link>
      </footer>
    </article>
  );
}
