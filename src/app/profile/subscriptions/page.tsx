import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/server/auth/session';
import { getSubscriptions } from '@/server/subscriptions';
import { PodcastsGrid } from '@/ui/PodcastsGrid';
import { EpisodesList } from '@/ui/EpisodesList';
import { ItemListSchema } from '@/components/Schema';
import type { IEpisodeInfo, IPodcastEpisodesInfo } from '@/types';

import { SubscriptionsTabs } from './SubscriptionsTabs';
import styles from './Subscriptions.module.css';

export const dynamic = 'force-dynamic';

export default async function ProfileSubscriptionsPage() {
  const session = await getSession();

  if (!session) {
    redirect('/auth');
  }

  const podcasts = await getSubscriptions(session.userId);

  if (!podcasts.length) {
    return <EmptyState />;
  }

  const episodes = getRecents(podcasts);

  return (
    <>
      <ItemListSchema items={podcasts} title="Subscriptions" />
      <SubscriptionsTabs podcasts={podcasts} episodes={episodes} />
    </>
  );
}

function EmptyState() {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M19 11a7 7 0 0 1-7 7m0 0a7 7 0 0 1-7-7m7 7v4m0 0h-3m3 0h3M12 4a7 7 0 0 0-7 7m14 0a7 7 0 0 0-7-7" />
        </svg>
      </div>
      <h1 className={styles.emptyTitle}>Your Library is Empty</h1>
      <p className={styles.emptyText}>
        Subscribe to podcasts to build your personal library. Your subscriptions
        sync across all your devices.
      </p>
      <Link href="/feed/top" className={styles.browseLink}>
        Browse popular podcasts
      </Link>
    </div>
  );
}

const FEED_EPISODES_LIMIT = 2;
const EPISODES_LIMIT = 50;

function getRecents(podcasts: IPodcastEpisodesInfo[]): IEpisodeInfo[] {
  return podcasts
    .flatMap((p) => p.episodes.slice(0, FEED_EPISODES_LIMIT))
    .sort((a, b) => (b.published || 0) - (a.published || 0))
    .slice(0, EPISODES_LIMIT);
}
