import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from '../account/Account.module.css';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How Podcst handles information on the web, iOS and Android, including optional accounts, synchronization and account deletion.',
  alternates: { canonical: '/privacy' },
};

const sections = [
  ['accounts', 'Using Podcst without an account'],
  ['information', 'Information we handle'],
  ['uses', 'How we use information'],
  ['services', 'Services and other recipients'],
  ['storage', 'Storage and security'],
  ['retention', 'How long we keep information'],
  ['deletion', 'Delete your Podcst account'],
  ['rights', 'Your rights and legal bases'],
  ['children', 'Children’s privacy'],
  ['changes', 'Changes to this policy'],
] as const;

type SectionId = (typeof sections)[number][0];

const title = (id: SectionId) =>
  sections.find(([section]) => section === id)?.[1];

const privacyEmail = <a href="mailto:privacy@podcst.app">privacy@podcst.app</a>;

function PolicySection({
  id,
  children,
}: {
  id: SectionId;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={`${styles.section} ${styles.deletion}`}
    >
      <h2 id={`${id}-heading`} className={styles.sectionTitle}>
        {title(id)}
      </h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div
      className={styles.page}
      style={{ gridTemplateColumns: 'minmax(0, 760px)' }}
    >
      <article className={styles.deletion}>
        <header className={styles.deletion}>
          <h1 className={styles.title}>Privacy Policy</h1>
          <p className={styles.meta}>Effective date: 27 October 2026</p>
          <p>
            Podcst is a podcast player for the web, iOS and Android. This policy
            explains how we handle information when you use Podcst and
            podcst.app. Podcst is operated by Shantanu Raj, an individual based
            in the Netherlands, who is the controller responsible for your
            personal data.
          </p>
          <p>For privacy questions and requests, contact {privacyEmail}.</p>
        </header>

        <nav aria-label="Privacy policy sections">
          <p>
            {sections.map(([id, label], index) => (
              <span key={id}>
                {index > 0 && ' · '}
                <a href={`#${id}`}>{label}</a>
              </span>
            ))}
          </p>
        </nav>

        <PolicySection id="accounts">
          <p>
            An account is optional on the web, iOS and Android. Almost every
            feature works without signing in on each platform: discovering,
            searching, following and listening to public podcasts, Starred
            episodes, your queue, playback settings, downloads in the apps and
            sharing. An account adds two things: synchronization of your
            follows, Starred episodes, listening progress and playback
            preferences across devices, and custom RSS feeds, including private
            feeds from podcast publishers.
          </p>
          <p>
            Without an account, your library and listening state stay on your
            device or in your browser and are never sent to Podcst. Search,
            streaming and other network requests still involve the processing
            described below, but they are not linked to an account.
          </p>
        </PolicySection>

        <PolicySection id="information">
          <p>
            <strong>Data stored only on your device.</strong> Without an
            account, the follows, Starred episodes, queue, listening positions,
            preferences and downloads you create are kept only in your browser
            or app. When you sign in, the app keeps your guest library separate
            from account data, so signing out or deleting an account does not
            remove it.
          </p>
          <p>
            <strong>Account and sign in.</strong> If you create an account, we
            store your email address, an account identifier, the creation date,
            your sign-in sessions and short-lived sign-in codes. Codes are
            stored only as hashes. If you add a passkey, we store its public
            key, credential identifier, the passkey provider reported by your
            device (for example iCloud Keychain or Google Password Manager),
            when it was added and when it was last used. Your biometric data and
            the passkey’s private key stay with your device or credential
            provider and are never sent to Podcst.
          </p>
          <p>
            <strong>Synchronized library and listening state.</strong> If you
            sign in, we store the podcasts you follow, Starred episodes and
            other episode lists, listening positions, completion status and
            playback preferences (speed, volume boost and silence trimming). We
            also store timestamps, revision numbers and app-generated client
            identifiers so changes from your devices synchronize reliably.
          </p>
          <p>
            <strong>Searches and feeds.</strong> We receive your search terms
            and selected chart or search region, including when you use Podcst
            without an account. Search terms are used to answer the request and
            are not saved to your account. Custom RSS feeds require an account.
            When you add a feed, we fetch it and store its URL, podcast and
            episode information for your account. Private feed URLs often
            contain a subscription access token issued by the publisher; we
            store these URLs so we can refresh the feed for you and never show
            them to other users.
          </p>
          <p>
            <strong>Technical information.</strong> Our servers and hosting
            providers process IP addresses, requested URLs, device and browser
            information and timestamps to deliver the service and keep it
            secure. Hosting providers record this in short-lived request and
            error logs. To limit abuse of sign in and account deletion, we keep
            short-lived, hashed records of email and IP addresses.
          </p>
          <p>
            <strong>Support.</strong> If you contact us, we receive your email
            address and whatever you include in your message.
          </p>
          <p>
            <strong>What we don’t collect.</strong> Podcst contains no
            advertising, analytics or crash-reporting software, and we do not
            build usage profiles. We do not access your contacts, photos,
            location, microphone or advertising identifier. Audio processing
            such as volume boost and silence trimming runs on your device.
          </p>
        </PolicySection>

        <PolicySection id="uses">
          <p>
            We use information to search for, retrieve and play podcasts, show
            charts for your region, keep the service running and secure, prevent
            abuse and respond to your requests. If you create an account, we
            also use it to sign you in, send sign-in and account-deletion codes,
            refresh your custom feeds and synchronize your library. An email
            address is required for an account and not for using Podcst without
            one. We only email you about signing in and account deletion.
          </p>
          <p>
            We do not sell personal information, and we do not use or share it
            for targeted or cross-context behavioral advertising. We do not
            track you across other companies’ apps or websites, and we do not
            use your information to train machine-learning models.
          </p>
        </PolicySection>

        <PolicySection id="services">
          <p>
            <strong>Hosting and infrastructure.</strong> Vercel and Fly.io serve
            the website and API. Our database and other servers run at Hetzner
            in Germany, and encrypted backups are stored with Amazon Web
            Services in Germany. These providers process information on our
            behalf to run Podcst.
          </p>
          <p>
            <strong>Email.</strong> Resend delivers sign-in and account-deletion
            codes. It receives your email address and the message content.
          </p>
          <p>
            <strong>Apple podcast search.</strong> For podcast searches, our
            server sends Apple’s iTunes Search API your search term and selected
            country or region. The request comes from our server, not your
            device, and does not include your IP address or any account
            information. Episode search and adding RSS links are handled by
            Podcst without Apple.
          </p>
          <p>
            <strong>Podcast publishers and hosts.</strong> Audio and linked
            pages come from podcast publishers, hosting companies,
            content-delivery networks and the measurement or redirect services
            they choose. When your device fetches them, they receive your IP
            address, the requested URL and normal request information such as
            your device or browser type. Publishers may use this for their own
            analytics or advertising under their own privacy policies, and
            private feed or media URLs can identify your subscription to that
            publisher. Podcst fetches feeds, chapters and artwork on its
            servers, so publishers do not see your IP address for those
            requests.
          </p>
          <p>
            <strong>Google Cast on Android.</strong> The Android app includes
            Google’s Cast SDK so you can play to Cast devices. Google states
            that the SDK collects anonymous interaction, device and app
            information to improve the service, that some collection happens
            automatically even when you are not casting, and that developers and
            users cannot opt out of or individually delete this data. Podcst
            does not receive it. When you cast, the selected receiver gets the
            episode and playback information. See{' '}
            <a href="https://developers.google.com/cast/docs/android_sender/data_disclosure">
              Google’s Cast SDK data disclosure
            </a>
            .
          </p>
          <p>
            <strong>Passkeys and AirPlay.</strong> Passkeys are created and used
            through Apple, Google or the credential manager you choose, under
            that provider’s terms. AirPlay on iOS and the web connects your
            device directly to the receiver you select.
          </p>
          <p>
            <strong>Web resources and sharing.</strong> The website loads fonts
            from Google Fonts and Google’s Cast script, so your browser connects
            to Google, which receives your IP address and browser information.
            When you share an episode or export your subscriptions, the
            information goes to the destination you choose. Exported
            subscription files can contain private feed links, so share them
            only with people you trust.
          </p>
          <p>
            We may disclose information when the law requires it, or when it is
            necessary to protect Podcst, its users or others from fraud or
            abuse, with the safeguards the law requires. If Podcst is
            transferred to a new operator, your information would move with it
            under this policy, and we would tell you beforehand.
          </p>
        </PolicySection>

        <PolicySection id="storage">
          <p>
            Podcst uses a sign-in cookie on the web and a session token stored
            in secure storage in the apps. It uses local storage for your
            preferences, library, listening state, caches and downloads. Guest
            data is kept separate from account data. You can remove local data
            through your browser or device settings, or by uninstalling the app.
            Removing it does not delete your Podcst account. Podcst does not use
            advertising or tracking cookies.
          </p>
          <p>
            All connections to Podcst use HTTPS, and connections between our own
            systems are encrypted and authenticated. Backups are encrypted with
            keys only we hold, and access to production systems is limited to
            the operator. Account sync and private feeds are not end-to-end
            encrypted, because our servers need to read them to synchronize your
            library and refresh your feeds. Some publishers use unencrypted HTTP
            links that we cannot secure.
          </p>
          <p>
            Vercel, Fly.io and Resend may process information in the United
            States. For transfers outside the European Economic Area, we rely on
            the EU–U.S. Data Privacy Framework where the provider is certified
            under it, and otherwise on the European Commission’s standard
            contractual clauses included in each provider’s data processing
            terms. Contact {privacyEmail} for details or a copy of the relevant
            safeguards.
          </p>
        </PolicySection>

        <PolicySection id="retention">
          <p>
            Account and synchronized data are kept for as long as your account
            exists. We do not delete inactive accounts automatically. Sign-in
            sessions expire after 30 days, and sign-in and deletion codes expire
            within minutes. Neither signing out nor uninstalling deletes your
            account.
          </p>
          <p>
            Hosting providers keep request and error logs for short periods
            under their own retention settings. Support emails are kept for as
            long as needed to resolve your request.
          </p>
          <p>
            Encrypted backups may contain account information and private feed
            addresses, and are kept for up to 12 months. Information deleted
            from the active service may remain in existing backups until they
            expire. We reapply recorded account deletions before any restored
            data is put back into use.
          </p>
        </PolicySection>

        <PolicySection id="deletion">
          <p>
            You can{' '}
            <Link href="/account#delete">
              delete your account in account settings
            </Link>
            , or open Settings → Delete account in the iOS or Android app. You
            confirm with a code we email you, and you can cancel at any point
            before you confirm. Once confirmed, deletion cannot be undone and
            you are signed out on every device.
          </p>
          <p>
            Deletion removes your account, email address, passkeys, sessions,
            follows, listening history, Starred episodes and lists, preferences
            and private feeds from the service. Public podcast listings remain
            available. Deleting your account does not cancel a publisher’s
            subscription or revoke a private feed token at the publisher. To do
            that, contact the publisher.
          </p>
          <p>
            Deletion usually completes immediately. If it cannot be confirmed
            straight away, the request stays pending and completes
            automatically, and you can check its status in the app or on the
            website. Until deletion is confirmed, the app keeps your saved data.
          </p>
          <p>
            After deletion is confirmed, the browser or device you used removes
            that account’s saved data, including downloads. Guest data and other
            accounts stay. Other devices are signed out but keep their saved
            copies until you remove them. Deletion cannot reach disconnected
            devices, system caches, publisher services or copies you exported.
          </p>
          <p>
            Some cached information derived from private feeds, such as chapter
            titles and artwork, is no longer available to your account after
            deletion and expires over time, chapter data within 180 days.
          </p>
          <p>
            We keep a minimal record of each deletion, an identifier and a
            timestamp with no email address, feeds or listening data, so that
            the deletion is reapplied if a backup is ever restored.
          </p>
          <p>For help with account deletion, contact {privacyEmail}.</p>
        </PolicySection>

        <PolicySection id="rights">
          <p>
            If you are in the European Economic Area or the United Kingdom, we
            rely on these legal bases:
          </p>
          <ul>
            <li>
              <strong>Providing the service you request</strong> (contract):
              search, playback, charts, accounts, sign in, synchronization,
              custom feeds and account deletion.
            </li>
            <li>
              <strong>Legitimate interests</strong>: keeping Podcst secure and
              available, preventing abuse, logs and backups, deletion records
              and supporting Google Cast on Android. Our interest is a reliable,
              secure service that respects deletions. You can object to this
              processing.
            </li>
            <li>
              <strong>Legal obligations</strong>: responding to lawful requests
              and keeping records the law requires.
            </li>
          </ul>
          <p>
            Depending on where you live, you may have the right to access,
            correct, delete or receive a portable copy of your personal data, to
            restrict processing, and to object to processing based on legitimate
            interests. You can export your subscriptions from your library at
            any time.
          </p>
          <p>
            To exercise your rights, contact {privacyEmail}. We respond within
            one month and may need to confirm that you control the account’s
            email address. You can also complain to a data protection authority.
            Our lead authority is the Dutch{' '}
            <a href="https://autoriteitpersoonsgegevens.nl">
              Autoriteit Persoonsgegevens
            </a>
            , and you can also contact the authority where you live.
          </p>
        </PolicySection>

        <PolicySection id="children">
          <p>
            Podcst is a general-audience service and is not directed at children
            under 13. Accounts are for people aged 13 or older, and in countries
            that set a higher age for consent, a parent or guardian must
            approve. Podcasts are made by independent publishers and some
            contain mature content. If you believe a child under 13 has created
            an account, contact {privacyEmail} and we will delete it.
          </p>
        </PolicySection>

        <PolicySection id="changes">
          <p>
            We will update this policy when our practices change, revise its
            effective date and give any notice the law requires. Contact{' '}
            {privacyEmail} with questions.
          </p>
        </PolicySection>
      </article>
    </div>
  );
}
