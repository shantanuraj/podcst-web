'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/shared/i18n';
import type { IEpisodeInfo } from '@/types';
import { ArtworkBackdrop } from '@/ui/ArtworkBackdrop/ArtworkBackdrop';
import { ShareIcon } from '@/ui/Button/ShareButton';
import { StarButton } from '@/ui/Button/StarButton';
import { ProxiedImage } from '@/ui/Image';
import { Menu } from '@/ui/Menu/Menu';
import { getEpisodeHref } from '../links';
import { episodeShareUrl, useShare } from '../share/useShare';
import { Airplay } from './Airplay';
import { Chromecast } from './Chromecast';
import {
  ClipEnd,
  clipLabel,
  PlayFull,
  SavedPlace,
  useClip,
} from './ClipControls';
import { episodeKey } from './episode-identity';
import { formatDuration, formatSecondsToTimestamp } from './formatTime';
import styles from './NowPlaying.module.css';
import { upNext } from './queue';
import { SpeedPresets } from './Speed';
import { Timeline } from './Timeline';
import { Transport } from './Transport';
import { useAccountPlayback } from './useAccountPlayback';
import { usePlayer } from './usePlayer';
import { useTimeline } from './useTimeline';
import { VolumeControls } from './VolumeControls';

type Panel = 'chapters' | 'upNext';

export function NowPlaying({
  episode,
  onClose,
}: {
  episode: IEpisodeInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDivElement>(null);
  const { chapter, chapters } = useTimeline(episode);
  const queue = usePlayer((state) => state.queue);
  const current = usePlayer((state) => state.currentTrackIndex);
  const active = usePlayer((state) => state.state !== 'idle');
  const clip = useClip(episode);
  const shareable = episodeShareUrl(episode) !== null;
  const next = useMemo(
    () => upNext({ queue, current, active: true }),
    [queue, current],
  );
  const [panel, setPanel] = useState<Panel>(
    chapters.length ? 'chapters' : 'upNext',
  );
  const shown: Panel =
    panel === 'chapters' && !chapters.length ? 'upNext' : panel;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', dismiss);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', dismiss);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={t('player.nowPlaying')}
      className={styles.stage}
    >
      <ArtworkBackdrop
        src={episode.episodeArt || episode.cover}
        privateSource={episode.isPrivate}
        className={styles.backdrop}
      />
      <header className={styles.top}>
        <button
          type="button"
          className={styles.collapse}
          onClick={onClose}
          aria-label={t('player.close')}
        >
          <span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
          {t('player.nowPlaying')}
        </button>
        <span className={styles.wordmark} aria-hidden="true">
          Podcst
        </span>
        <div className={styles.tools}>
          <Airplay />
          <Chromecast />
          <Menu
            label={t('player.more')}
            side="bottom"
            trigger={
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            }
          >
            {(close) => (
              <>
                {shareable && (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      useShare.getState().open({ episode, mode: 'time' });
                    }}
                  >
                    {t('share.title')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!active}
                  onClick={() => {
                    usePlayer.getState().stop();
                    close();
                  }}
                >
                  {t('player.stop')}
                  <small>{t('player.stopHint')}</small>
                </button>
                <button
                  type="button"
                  disabled={!active}
                  onClick={() => {
                    usePlayer.getState().markPlayed();
                    close();
                  }}
                >
                  {t('player.markPlayed')}
                </button>
              </>
            )}
          </Menu>
        </div>
      </header>

      <div className={styles.main}>
        <div className={styles.cover}>
          <ProxiedImage
            alt=""
            src={episode.episodeArt || episode.cover}
            privateSource={episode.isPrivate}
            sizes="(max-width: 767px) 80vw, 500px"
          />
        </div>
        <div className={styles.details}>
          <p className={styles.eyebrow} data-clip={!!clip}>
            {clip ? clipLabel(t, clip) : episode.podcastTitle || episode.author}
          </p>
          <div className={styles.heading}>
            <h2 className={styles.title}>
              <Link href={getEpisodeHref(episode)} onClick={onClose}>
                {episode.title}
              </Link>
            </h2>
            <StarButton episode={episode} className={styles.star} />
          </div>
          {chapter && (
            <p className={styles.chapter}>
              <span>
                {t('player.chapterOf', {
                  number: chapter.index + 1,
                  total: chapters.length,
                })}
              </span>
              <em>
                {chapter.title ||
                  t('chapters.untitled', { number: chapter.index + 1 })}
              </em>
            </p>
          )}
          <div className={styles.timeline}>
            <Timeline episode={episode} size="stage" />
          </div>
          {clip?.ended ? (
            <div className={styles.transport}>
              <ClipEnd clip={clip} queueable />
              <SavedPlace episode={episode} />
            </div>
          ) : (
            <div className={styles.transport}>
              <Transport episode={episode} size="stage" />
            </div>
          )}
          <div className={styles.audio}>
            <SpeedPresets />
            <VolumeControls />
            {clip && !clip.ended && <PlayFull />}
          </div>
        </div>
      </div>

      <section className={styles.panels}>
        <div className={styles.tabs} role="tablist">
          {chapters.length > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={shown === 'chapters'}
              onClick={() => setPanel('chapters')}
            >
              {t('chapters.title')}
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={shown === 'upNext'}
            onClick={() => setPanel('upNext')}
          >
            {t('player.upNext')} · {next.length}
          </button>
          <Link
            href={`${getEpisodeHref(episode)}#show-notes`}
            onClick={onClose}
          >
            {t('podcast.showNotes')}
          </Link>
        </div>
        <div role="tabpanel">
          {shown === 'chapters' ? (
            <ChapterCards episode={episode} shareable={shareable} />
          ) : (
            <UpNextList episodes={next} />
          )}
        </div>
      </section>
    </div>
  );
}

function ChapterCards({
  episode,
  shareable,
}: {
  episode: IEpisodeInfo;
  shareable: boolean;
}) {
  const { t } = useTranslation();
  const withAccount = useAccountPlayback();
  const { chapters, chapter, segments } = useTimeline(episode);
  return (
    <ol className={styles.cards}>
      {chapters.map((item, index) => {
        const title =
          item.title || t('chapters.untitled', { number: index + 1 });
        const timestamp = formatSecondsToTimestamp(item.start);
        const fill = segments[index]?.fill ?? 0;
        return (
          <li key={item.start}>
            <button
              type="button"
              aria-current={chapter?.index === index ? 'true' : undefined}
              data-played={fill >= 1}
              aria-label={t('chapters.seek', { title, timestamp })}
              onClick={() =>
                withAccount(episode, () =>
                  usePlayer.getState().seekOrStartAt(episode, item.start),
                )
              }
            >
              <span className={styles.start}>{timestamp}</span>
              <span className={styles.cardTitle}>{title}</span>
              <span className={styles.cardProgress}>
                <span style={{ width: `${fill * 100}%` }} />
              </span>
            </button>
            {shareable && (
              <button
                type="button"
                className={styles.shareChapter}
                aria-label={t('share.shareChapter', { title })}
                onClick={() =>
                  useShare
                    .getState()
                    .open({ episode, mode: 'chapter', chapter: index })
                }
              >
                <ShareIcon />
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function UpNextList({ episodes }: { episodes: readonly IEpisodeInfo[] }) {
  const { t } = useTranslation();
  const withAccount = useAccountPlayback();
  if (!episodes.length)
    return <p className={styles.empty}>{t('queue.empty')}</p>;
  return (
    <ol className={styles.upNext}>
      {episodes.map((episode) => (
        <li key={episodeKey(episode)}>
          <button
            type="button"
            onClick={() =>
              withAccount(episode, () =>
                usePlayer.getState().playEpisode(episode),
              )
            }
          >
            <ProxiedImage
              alt=""
              src={episode.episodeArt || episode.cover}
              privateSource={episode.isPrivate}
              sizes="44px"
            />
            <span className={styles.upNextText}>
              <span className={styles.cardTitle}>{episode.title}</span>
              <small>
                {[
                  episode.podcastTitle || episode.author,
                  episode.duration ? formatDuration(t, episode.duration) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
