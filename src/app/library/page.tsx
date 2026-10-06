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
import type { IEpisodeInfo, IPodcastEpisodesInfo } from '@/types';
import { ArtworkBackdrop } from '@/ui/ArtworkBackdrop/ArtworkBackdrop';
import { Button } from '@/ui/Button';
import { ProxiedImage } from '@/ui/Image';
import { Icon } from '@/ui/icons/svg/Icon';
import { PageLink } from '@/ui/PageLink/PageLink';
import styles from './Library.module.css';

const CONTINUE = 3;
const RELEASES = 8;
type Order = 'title' | 'updated' | 'added';

export default function LibraryPage() {
  const { t } = useTranslation();
  const { data: user, isLoading } = useSession();
  const podcasts = usePodcasts(!!user);
  const recent = useRecentProgress(CONTINUE);
  const playing = usePlayer(getCurrentEpisode);
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
  const progress = useEpisodeProgress(
    user
      ? podcasts.flatMap(({ episodes }) =>
          episodes.slice(0, 1).flatMap(({ id }) => (id ? [id] : [])),
        )
      : [],
  );
  const starred = useStars();

  if (isLoading) return null;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>{t('library.title')}</h1>
        <div className={styles.headerActions}>
          <OpmlImport />
          <Button
            type="button"
            disabled={!podcasts.length}
            onClick={() =>
              downloadOpml(podcasts.map(({ title, feed }) => ({ title, feed })))
            }
          >
            {t('account.exportOpml', { count: podcasts.length })}
          </Button>
        </div>
      </header>
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
      {podcasts.length === 0 ? (
        <Empty />
      ) : (
        <div className={styles.columns}>
          <Releases episodes={releases} />
          <Subscriptions
            podcasts={podcasts}
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
            {starred.stars.map(({ episodeId, episode, availability }) =>
              episode ? (
                <ReleaseRow key={episodeId} episode={episode} when={null} />
              ) : (
                <li key={episodeId}>
                  {availability === 'unavailable'
                    ? 'Episode unavailable'
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

function usePodcasts(signedIn: boolean): IPodcastEpisodesInfo[] {
  const { data: remote } = useServerSubscriptions();
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

function Releases({ episodes }: { episodes: IEpisodeInfo[] }) {
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
    <section>
      <div className={styles.sectionHead}>
        <h2>{t('library.newEpisodes')}</h2>
        <span>{t('library.lastWeek')}</span>
      </div>
      {rows.length ? (
        <ul>
          {rows.map(({ episode, when }) => (
            <ReleaseRow
              key={episode.id ?? episode.guid}
              episode={episode}
              when={when}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.quiet}>{t('library.noNewEpisodes')}</p>
      )}
    </section>
  );
}

function ReleaseRow({
  episode,
  when,
}: {
  episode: IEpisodeInfo;
  when: string | null;
}) {
  const { t } = useTranslation();
  const withAccount = useAccountPlayback();
  return (
    <li className={styles.release}>
      <ProxiedImage
        alt=""
        src={episode.episodeArt || episode.cover}
        privateSource={episode.isPrivate}
        sizes="44px"
        loading="lazy"
      />
      <div className={styles.releaseText}>
        <PageLink
          href={getEpisodeHref(episode)}
          loading="podcast"
          className={styles.releaseTitle}
        >
          {episode.title}
        </PageLink>
        <span className={styles.meta}>
          {[episode.podcastTitle, when].filter(Boolean).join(' · ')}
        </span>
      </div>
      <span className={styles.duration}>
        {episode.duration ? formatDuration(t, episode.duration) : ''}
      </span>
      <button
        type="button"
        className={styles.releasePlay}
        aria-label={`${t('player.play')} ${episode.title}`}
        onClick={() =>
          withAccount(episode, () => usePlayer.getState().playEpisode(episode))
        }
      >
        <Icon icon="play" size={12} />
      </button>
    </li>
  );
}

function Subscriptions({
  podcasts,
  played,
}: {
  podcasts: IPodcastEpisodesInfo[];
  played: (episode: IEpisodeInfo) => boolean;
}) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<Order>('added');
  const [now] = useState(() => Date.now());
  const current = usePlayer(getCurrentEpisode);
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
    <section>
      <div className={styles.sectionHead}>
        <h2>{t('library.subscriptions')}</h2>
        <label className={styles.order}>
          <span>{podcasts.length} ·</span>
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
      </ul>
    </section>
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
