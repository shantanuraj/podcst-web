'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { OpmlImport } from '@/components/OpmlImport/OpmlImport';
import {
  type RecentProgress,
  useEpisodeProgress,
  useRecentProgress,
} from '@/data/progress';
import { useDurableState } from '@/data/state-browser';
import { localeForLanguage } from '@/messages';
import { useSession } from '@/shared/auth/useAuth';
import { useTranslation } from '@/shared/i18n';
import { getEpisodeHref, getPodcastHref } from '@/shared/links';
import { downloadOpml } from '@/shared/opml';
import { sameEpisode } from '@/shared/player/episode-identity';
import { formatDuration } from '@/shared/player/formatTime';
import { useAccountPlayback } from '@/shared/player/useAccountPlayback';
import { getCurrentEpisode, usePlayer } from '@/shared/player/usePlayer';
import { newReleases, releaseSections } from '@/shared/releases';
import { useStars } from '@/shared/stars/useStars';
import { useServerSubscriptions } from '@/shared/subscriptions/useServerSubscriptions';
import { useSubscriptions } from '@/shared/subscriptions/useSubscriptions';
import type {
  EpisodeProgress,
  IEpisodeInfo,
  IPodcastEpisodesInfo,
} from '@/types';
import { ArtworkBackdrop } from '@/ui/ArtworkBackdrop/ArtworkBackdrop';
import { Button } from '@/ui/Button';
import { GuestProgressTransfer } from '@/ui/EpisodeInfo/GuestProgressTransfer';
import { ProxiedImage } from '@/ui/Image';
import { Icon } from '@/ui/icons/svg/Icon';
import { PageLink } from '@/ui/PageLink/PageLink';
import styles from './Library.module.css';
import { ReleaseRow } from './ReleaseRow';

const CONTINUE = 3;
const RELEASES = 8;
type Order = 'title' | 'updated' | 'added';

export default function LibraryPage() {
  const { t } = useTranslation();
  const { data: user, isLoading } = useSession();
  const subscriptions = useServerSubscriptions();
  const podcasts = usePodcasts(!!user, subscriptions.data);
  const recent = useRecentProgress(CONTINUE);
  const localError = useSubscriptions((state) => state.error);
  const localInitialized = useSubscriptions((state) => state.initialized);
  const playing = usePlayer(getCurrentEpisode);
  const queueError = usePlayer((state) => state.storageError);
  const started = usePlayer((state) => state.seekPosition > 0);
  const continuing = useMemo(
    () =>
      (user
        ? recent
        : playing && started
          ? [{ episode: playing, position: usePlayer.getState().seekPosition }]
          : []
      ).slice(0, CONTINUE),
    [user, recent, playing, started],
  );
  const releases = useMemo(() => newReleases(podcasts), [podcasts]);
  const starred = useStars();
  const durable = useDurableState();
  const loading = user
    ? !subscriptions.isError &&
      !durable.error &&
      (!subscriptions.initialized || subscriptions.isPending)
    : !localInitialized && !localError && !durable.error;
  const pending = !!user && (subscriptions.isFetching || subscriptions.pending);
  const progress = useEpisodeProgress(
    user
      ? [...releases, ...starred.episodes].flatMap(({ id }) => (id ? [id] : []))
      : [],
  );

  if (isLoading) return null;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>{t('library.title')}</h1>
        <div className={styles.headerActions}>
          <OpmlImport />
          <Button
            type="button"
            disabled={loading || !podcasts.length}
            onClick={() =>
              downloadOpml(podcasts.map(({ title, feed }) => ({ title, feed })))
            }
          >
            {t('account.exportOpml', {
              count: loading ? '…' : podcasts.length,
            })}
          </Button>
        </div>
      </header>
      <p role="status" className={styles.status}>
        {durable.error}
        {queueError}
      </p>
      {durable.failedProgress.length > 0 && (
        <div role="status" className={styles.notice}>
          <p>
            Listening progress could not be saved for{' '}
            {durable.failedProgress.length} unavailable{' '}
            {durable.failedProgress.length === 1 ? 'episode' : 'episodes'}.
          </p>
          <Button
            type="button"
            onClick={() => {
              void durable
                .dismissFailures({
                  progress: durable.failedProgress,
                })
                .catch(() => {});
            }}
          >
            Dismiss
          </Button>
        </div>
      )}
      {user && durable.unresolvedFollows.length > 0 && (
        <ul>
          {durable.unresolvedFollows.map((feed) => (
            <li key={feed}>
              {feed}{' '}
              <button
                type="button"
                onClick={() => {
                  void durable.sync.resolveFeeds([feed], true).catch(() => {});
                }}
              >
                Resolve and follow
              </button>
            </li>
          ))}
        </ul>
      )}
      {user && durable.unresolvedImports.length > 0 && (
        <ul>
          {durable.unresolvedImports.map((feed) => (
            <li key={feed}>
              {feed}{' '}
              <button
                type="button"
                onClick={() => {
                  void durable.sync.resolveFeeds([feed]).catch(() => {});
                }}
              >
                Retry import
              </button>
            </li>
          ))}
        </ul>
      )}
      {(subscriptions.isError || localError) && (
        <p role="alert">
          {localError ??
            'Unable to read your library. This is not an empty library.'}
        </p>
      )}
      <GuestProgressTransfer />
      {continuing.length > 0 && (
        <section>
          <h2 className={styles.eyebrow}>{t('library.continue')}</h2>
          <div className={styles.continue}>
            {continuing.map((item) => (
              <ContinueCard
                key={item.episode.id ?? item.episode.guid}
                {...item}
              />
            ))}
          </div>
        </section>
      )}
      {!loading &&
      podcasts.length === 0 &&
      (!user ||
        (subscriptions.isSuccess &&
          subscriptions.initialized &&
          subscriptions.membership.size === 0)) &&
      !subscriptions.isError &&
      !durable.error &&
      !localError ? (
        <Empty />
      ) : (
        <div className={styles.columns}>
          <Releases
            episodes={releases}
            progress={progress}
            loading={loading || (pending && podcasts.length === 0)}
            failed={subscriptions.isError || !!localError || !!durable.error}
          />
          <Subscriptions
            podcasts={podcasts}
            membership={user ? subscriptions.membership : undefined}
            loading={loading}
            pending={pending}
            detailsAvailable={!user || subscriptions.isSuccess}
            unfollow={(id) => {
              void durable.sync.follow(id, false).catch(() => {});
            }}
            played={(episode) => {
              const saved = episode.id ? progress.get(episode.id) : undefined;
              return !!saved && (saved.completed || saved.position > 0);
            }}
          />
        </div>
      )}
      {(starred.stars.length > 0 || starred.pending || starred.error) && (
        <section className={styles.starred}>
          <div className={styles.sectionHead}>
            <h2>{t('library.starred')}</h2>
            <span>{starred.stars.length}</span>
            <button type="button" onClick={() => void starred.refresh()}>
              Refresh
            </button>
          </div>
          {(starred.error || starred.pending) && (
            <p role="status">
              {starred.error ?? 'Saved on this device. Waiting to sync…'}
            </p>
          )}
          <ul>
            {starred.stars.map(
              ({ episodeId, episode, availability, freshness }) =>
                episode ? (
                  <ReleaseRow
                    key={episodeId}
                    episode={episode}
                    when={null}
                    progress={progress.get(episodeId)}
                  />
                ) : (
                  <li key={episodeId}>
                    {availability === 'unavailable'
                      ? 'Episode unavailable'
                      : freshness?.state === 'pending'
                        ? 'Preparing episode…'
                        : 'Episode details unavailable'}
                    <button
                      type="button"
                      onClick={() => starred.unstar(episodeId)}
                    >
                      {t('library.unstar')}
                    </button>
                  </li>
                ),
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

function usePodcasts(
  signedIn: boolean,
  remote: IPodcastEpisodesInfo[] | undefined,
): IPodcastEpisodesInfo[] {
  const local = useSubscriptions(
    useShallow((state) => Object.values(state.subs)),
  );
  const init = useSubscriptions((state) => state.init);
  const sync = useSubscriptions((state) => state.syncAllSubscriptions);
  useEffect(() => {
    if (!signedIn) void init().then(sync);
  }, [signedIn, init, sync]);
  return signedIn ? (remote ?? []) : local;
}

function ContinueCard({ episode, position }: RecentProgress) {
  const { t } = useTranslation();
  const withAccount = useAccountPlayback();
  const live = usePlayer((state) =>
    sameEpisode(getCurrentEpisode(state), episode) ? state : null,
  );
  const at = live?.seekPosition ?? position;
  const duration = episode.duration || 0;
  const playing = live?.state === 'playing' || live?.state === 'buffering';
  return (
    <article className={styles.card}>
      <ArtworkBackdrop
        src={episode.episodeArt || episode.cover}
        privateSource={episode.isPrivate}
        className={styles.tint}
      />
      <ProxiedImage
        alt=""
        src={episode.episodeArt || episode.cover}
        privateSource={episode.isPrivate}
        sizes="84px"
        className={styles.cardArt}
      />
      <div className={styles.cardText}>
        <span className={styles.cardShow}>{episode.podcastTitle}</span>
        <PageLink
          href={getEpisodeHref(episode)}
          loading="podcast"
          className={styles.cardTitle}
        >
          {episode.title}
        </PageLink>
        <div className={styles.cardProgress}>
          <span className={styles.bar}>
            <span
              style={{
                width: duration ? `${Math.min(at / duration, 1) * 100}%` : 0,
              }}
            />
          </span>
          {duration > 0 && (
            <span>
              {t('player.remaining', {
                time: formatDuration(t, duration - at),
              })}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        className={styles.cardPlay}
        aria-label={playing ? t('player.pause') : t('player.resume')}
        onClick={() =>
          withAccount(episode, () => {
            const player = usePlayer.getState();
            if (live && live.state !== 'idle') player.togglePlayback();
            else player.playEpisode(episode, at);
          })
        }
      >
        <Icon icon={playing ? 'pause' : 'play'} size={16} />
      </button>
    </article>
  );
}

function Releases({
  episodes,
  progress,
  loading,
  failed,
}: {
  episodes: IEpisodeInfo[];
  progress: ReadonlyMap<string, EpisodeProgress>;
  loading: boolean;
  failed: boolean;
}) {
  const { t, language } = useTranslation();
  const [now] = useState(() => Date.now());
  const sections = releaseSections(episodes, now, localeForLanguage[language], {
    today: t('library.today'),
    yesterday: t('library.yesterday'),
    unavailable: t('library.dateUnavailable'),
  }).filter(({ recent }) => recent);
  const rows = sections
    .flatMap(({ title, episodes }) =>
      episodes.map((episode) => ({ episode, when: title })),
    )
    .slice(0, RELEASES);
  return (
    <section aria-busy={loading}>
      <div className={styles.sectionHead}>
        <h2>{t('library.newEpisodes')}</h2>
        <span>{t('library.lastWeek')}</span>
      </div>
      {loading && <LoadingStatus />}
      {rows.length ? (
        <ul>
          {rows.map(({ episode, when }) => (
            <ReleaseRow
              key={episode.id ?? episode.guid}
              episode={episode}
              when={when}
              progress={episode.id ? progress.get(episode.id) : undefined}
            />
          ))}
        </ul>
      ) : loading ? (
        <ul aria-hidden="true">
          {Array.from({ length: RELEASES }, (_, index) => (
            <li className={styles.release} key={index}>
              <span className={styles.loadingArt} />
              <div className={styles.releaseText}>
                <span className={styles.loadingTitle} />
                <span className={styles.loadingMeta} />
              </div>
            </li>
          ))}
        </ul>
      ) : failed ? null : (
        <p className={styles.quiet}>{t('library.noNewEpisodes')}</p>
      )}
    </section>
  );
}

function Subscriptions({
  podcasts,
  membership,
  loading,
  pending,
  detailsAvailable,
  unfollow,
  played,
}: {
  podcasts: IPodcastEpisodesInfo[];
  membership?: ReadonlyMap<string, string>;
  loading: boolean;
  pending: boolean;
  detailsAvailable: boolean;
  unfollow: (id: string) => void;
  played: (episode: IEpisodeInfo) => boolean;
}) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<Order>('added');
  const [now] = useState(() => Date.now());
  const current = usePlayer(getCurrentEpisode);
  const ids = new Set(podcasts.map(({ id }) => id));
  const missing = [...(membership ?? [])].filter(([id]) => !ids.has(id));
  const placeholders = loading
    ? missing.length || RELEASES
    : pending
      ? missing.length
      : 0;
  const count = membership?.size ?? podcasts.length;
  const sorted = useMemo(() => {
    const latest = (podcast: IPodcastEpisodesInfo) =>
      podcast.episodes[0]?.published ?? 0;
    return order === 'title'
      ? [...podcasts].sort((a, b) => a.title.localeCompare(b.title))
      : order === 'updated'
        ? [...podcasts].sort((a, b) => latest(b) - latest(a))
        : podcasts;
  }, [podcasts, order]);
  return (
    <section aria-busy={loading || placeholders > 0}>
      <div className={styles.sectionHead}>
        <h2>{t('library.subscriptions')}</h2>
        <label className={styles.order}>
          <span>{loading && !count ? '…' : count} ·</span>
          <select
            value={order}
            onChange={(event) => setOrder(event.currentTarget.value as Order)}
          >
            <option value="added">{t('library.orderAdded')}</option>
            <option value="updated">{t('library.orderUpdated')}</option>
            <option value="title">{t('library.orderTitle')}</option>
          </select>
        </label>
      </div>
      {(loading || placeholders > 0) && <LoadingStatus />}
      <ul className={styles.grid}>
        {sorted.map((podcast) => {
          const latest = podcast.episodes[0];
          const fresh =
            !!latest?.published &&
            now - latest.published < 7 * 86_400_000 &&
            !played(latest) &&
            !sameEpisode(current, latest);
          return (
            <li key={podcast.feed}>
              <PageLink
                href={getPodcastHref(podcast)}
                loading="podcast"
                className={styles.tile}
                title={podcast.title}
              >
                <ProxiedImage
                  alt={podcast.title}
                  src={podcast.cover}
                  privateSource={podcast.isPrivate}
                  sizes="(max-width: 767px) 30vw, 120px"
                  loading="lazy"
                />
                {fresh && (
                  <span
                    className={styles.dot}
                    aria-label={t('library.unplayed')}
                  />
                )}
              </PageLink>
            </li>
          );
        })}
        {Array.from({ length: placeholders }, (_, index) => (
          <li
            className={styles.loadingTile}
            aria-hidden="true"
            key={`loading-${index}`}
          />
        ))}
      </ul>
      {!loading && !pending && detailsAvailable && missing.length > 0 && (
        <ul className={styles.unavailable}>
          {missing.map(([id, availability]) => (
            <li key={id}>
              <span>
                {availability === 'unavailable'
                  ? 'Podcast unavailable'
                  : 'Podcast details unavailable'}
              </span>
              <Button type="button" onClick={() => unfollow(id)}>
                Unfollow
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LoadingStatus() {
  const { t } = useTranslation();
  return (
    <span className="sr-only" role="status">
      {t('common.loading')}
    </span>
  );
}

function Empty() {
  const { t } = useTranslation();
  return (
    <div className={styles.empty}>
      <h2>{t('library.emptyLibrary')}</h2>
      <p>{t('library.emptyLibraryDescription')}</p>
      <Link href="/feed/top" className={styles.browse}>
        {t('library.browsePopular')}
      </Link>
    </div>
  );
}
