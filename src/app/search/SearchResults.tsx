'use client';

import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { SubscribeButton } from '@/components/SubscribeButton/SubscribeButton';
import { useEpisodeSearch, useSearch } from '@/data/search';
import { localeForLanguage } from '@/messages';
import { useSession } from '@/shared/auth/useAuth';
import { isFeedUrlInput } from '@/shared/feed-url';
import { useTranslation } from '@/shared/i18n';
import { getEpisodeHref, getSearchResultHref } from '@/shared/links';
import { formatDuration } from '@/shared/player/formatTime';
import { useAccountPlayback } from '@/shared/player/useAccountPlayback';
import { usePlayer } from '@/shared/player/usePlayer';
import type { IEpisodeInfo, IPodcastSearchResult } from '@/types';
import { ArtworkBackdrop } from '@/ui/ArtworkBackdrop/ArtworkBackdrop';
import { ProxiedImage } from '@/ui/Image';
import { Icon } from '@/ui/icons/svg/Icon';
import { PageLink } from '@/ui/PageLink/PageLink';
import styles from './Search.module.css';

type Tab = 'all' | 'podcasts' | 'episodes';

export function SearchResults({ term }: { term: string }) {
  const { t } = useTranslation();
  const feed = isFeedUrlInput(term);
  const podcasts = useSearch(term);
  const episodes = useEpisodeSearch(term);
  const [tab, setTab] = useState<Tab>('all');
  const podcastList = podcasts.data ?? [];
  const episodeList = episodes.data ?? [];

  if (!term)
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{t('search.title')}</h1>
        <p className={styles.quiet}>{t('search.prompt')}</p>
      </div>
    );

  if (feed)
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{t('search.addFeed')}</h1>
        <FeedResult
          needsSignIn={podcasts.needsSignIn}
          loading={podcasts.isFetching}
          failed={podcasts.isError}
          podcast={podcastList[0]}
        />
      </div>
    );

  const [top, ...rest] = podcastList;
  const showPodcasts = tab !== 'episodes';
  const showEpisodes = tab !== 'podcasts';
  const loading = podcasts.isFetching || episodes.isFetching;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>
          <span className={styles.muted}>{t('search.resultsFor')}</span>{' '}
          <em>{term}</em>
        </h1>
        <fieldset className={styles.tabs} aria-label={t('search.title')}>
          {(
            [
              ['all', t('search.all'), podcastList.length + episodeList.length],
              ['podcasts', t('search.podcasts'), podcastList.length],
              ['episodes', t('search.episodes'), episodeList.length],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {label} {count}
            </button>
          ))}
        </fieldset>
      </div>
      {!loading && !podcastList.length && !episodeList.length && (
        <p className={styles.quiet}>{t('search.noResults')}</p>
      )}
      <div className={styles.columns} data-tab={tab}>
        {showPodcasts && podcastList.length > 0 && (
          <div>
            {top && (
              <>
                <h2 className={styles.eyebrow}>{t('search.topResult')}</h2>
                <TopResult podcast={top} />
              </>
            )}
            {rest.length > 0 && (
              <>
                <h2 className={styles.eyebrow}>{t('search.podcasts')}</h2>
                <ul>
                  {rest.map((podcast) => (
                    <PodcastRow
                      key={podcast.id ?? podcast.feed}
                      podcast={podcast}
                    />
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {showEpisodes && episodeList.length > 0 && (
          <div>
            <h2 className={styles.eyebrow}>{t('search.episodes')}</h2>
            <ul>
              {episodeList.map((episode) => (
                <EpisodeResult key={episode.id} episode={episode} term={term} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function TopResult({ podcast }: { podcast: IPodcastSearchResult }) {
  return (
    <article className={styles.top}>
      <ArtworkBackdrop
        src={podcast.cover}
        privateSource={podcast.isPrivate}
        className={styles.tint}
      />
      <PageLink
        href={getSearchResultHref(podcast)}
        loading="podcast"
        className={styles.topArt}
      >
        <ProxiedImage
          alt=""
          src={podcast.cover}
          privateSource={podcast.isPrivate}
          sizes="150px"
        />
      </PageLink>
      <div className={styles.topText}>
        <PageLink
          href={getSearchResultHref(podcast)}
          loading="podcast"
          className={styles.topTitle}
        >
          {podcast.title}
        </PageLink>
        <span className={styles.meta}>{podcast.author}</span>
        <Subscribe podcast={podcast} />
      </div>
    </article>
  );
}

function Subscribe({ podcast }: { podcast: IPodcastSearchResult }) {
  const { data: user } = useSession();
  if (!user || !podcast.id) return null;
  return (
    <div className={styles.topActions}>
      <SubscribeButton
        info={{
          id: podcast.id,
          feed: podcast.feed,
          title: podcast.title,
          author: podcast.author,
          cover: podcast.cover,
          isPrivate: podcast.isPrivate,
          link: null,
          published: null,
          description: '',
          keywords: [],
          explicit: false,
          episodes: [],
        }}
      />
    </div>
  );
}

function PodcastRow({ podcast }: { podcast: IPodcastSearchResult }) {
  return (
    <li>
      <PageLink
        href={getSearchResultHref(podcast)}
        loading="podcast"
        className={styles.row}
      >
        <ProxiedImage
          alt=""
          src={podcast.thumbnail || podcast.cover}
          privateSource={podcast.isPrivate}
          sizes="44px"
          loading="lazy"
          className={styles.rowArt}
        />
        <span className={styles.rowText}>
          <span className={styles.rowTitle}>{podcast.title}</span>
          <span className={styles.meta}>{podcast.author}</span>
        </span>
        <Icon icon="caret" size={14} className={styles.chevron} />
      </PageLink>
    </li>
  );
}

function highlight(text: string, term: string): ReactNode[] {
  const words = term
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (!words.length) return [text];
  const pattern = new RegExp(
    `(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'giu',
  );
  return text
    .split(pattern)
    .map((part, index) =>
      index % 2 ? <mark key={`${index}-${part}`}>{part}</mark> : part,
    );
}

function EpisodeResult({
  episode,
  term,
}: {
  episode: IEpisodeInfo;
  term: string;
}) {
  const { t, language } = useTranslation();
  const withAccount = useAccountPlayback();
  const meta = [
    episode.published
      ? new Date(episode.published).toLocaleDateString(
          localeForLanguage[language],
          {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          },
        )
      : null,
    episode.duration ? formatDuration(t, episode.duration) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className={styles.episode}>
      <ProxiedImage
        alt=""
        src={episode.episodeArt || episode.cover}
        sizes="56px"
        loading="lazy"
        className={styles.episodeArt}
      />
      <div className={styles.rowText}>
        <span className={styles.show}>{episode.podcastTitle}</span>
        <PageLink
          href={getEpisodeHref(episode)}
          loading="podcast"
          className={styles.episodeTitle}
        >
          {highlight(episode.title, term)}
        </PageLink>
        {meta && <span className={styles.meta}>{meta}</span>}
      </div>
      <button
        type="button"
        className={styles.play}
        aria-label={`${t('player.play')} ${episode.title}`}
        onClick={() =>
          withAccount(episode, () => usePlayer.getState().playEpisode(episode))
        }
      >
        <Icon icon="play" size={13} />
      </button>
    </li>
  );
}

function FeedResult({
  needsSignIn,
  loading,
  failed,
  podcast,
}: {
  needsSignIn: boolean;
  loading: boolean;
  failed: boolean;
  podcast?: IPodcastSearchResult;
}) {
  const { t } = useTranslation();
  if (needsSignIn)
    return (
      <div className={styles.notice}>
        <p>{t('search.feedSignIn')}</p>
        <Link href="/auth" className={styles.primary}>
          {t('nav.signIn')}
        </Link>
      </div>
    );
  if (loading) return <p className={styles.quiet}>{t('common.loading')}</p>;
  if (failed || !podcast)
    return <p className={styles.quiet}>{t('search.feedUnavailable')}</p>;
  return <TopResult podcast={podcast} />;
}
