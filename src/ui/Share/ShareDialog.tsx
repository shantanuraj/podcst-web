'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  type Chapter,
  chapterEnd,
  currentChapterIndex,
} from '@/shared/chapters';
import { useTranslation } from '@/shared/i18n';
import { sameEpisode } from '@/shared/player/episode-identity';
import {
  formatDuration,
  formatSecondsToTimestamp,
} from '@/shared/player/formatTime';
import { useChapters } from '@/shared/player/useChapters';
import { getCurrentEpisode, usePlayer } from '@/shared/player/usePlayer';
import { playableChapters } from '@/shared/player/useTimeline';
import {
  episodeShareUrl,
  podcastShareUrl,
  type SharedPodcast,
  type ShareMode,
  type ShareRequest,
  useShare,
} from '@/shared/share/useShare';
import type { Moment } from '@/shared/share-link';
import { useToast } from '@/shared/toast/useToast';
import type { IEpisodeInfo } from '@/types';
import { ProxiedImage } from '@/ui/Image';
import { ClipTrimmer } from './ClipTrimmer';
import styles from './Share.module.css';
import { TimeInput } from './TimeInput';

const CLIP_SECONDS = 60;
const NUDGE_SECONDS = 15;

export function ShareDialog() {
  const request = useShare((state) => state.request);
  return request && <ShareSheet key={requestKey(request)} request={request} />;
}

const requestKey = (request: ShareRequest) =>
  request.episode
    ? `${request.episode.id}:${request.mode}:${request.chapter ?? ''}`
    : `show:${request.podcast.id}`;

function ShareSheet({ request }: { request: ShareRequest }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={heading}
      onClose={() => useShare.getState().close()}
      onPointerDown={(event) => {
        if (event.target === dialog.current) dialog.current.close();
      }}
    >
      <header className={styles.header}>
        <h2 id={heading}>{t('share.title')}</h2>
        <button
          type="button"
          className={styles.dismiss}
          onClick={() => dialog.current?.close()}
          aria-label={t('share.close')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      {request.episode ? (
        <EpisodeShare
          episode={request.episode}
          initialMode={request.mode}
          initialChapter={request.chapter}
        />
      ) : (
        <ShowShare podcast={request.podcast} />
      )}
    </dialog>
  );
}

function ShowShare({ podcast }: { podcast: SharedPodcast }) {
  return (
    <>
      <Summary
        art={podcast.cover}
        title={podcast.title}
        detail={podcast.author}
        privateSource={podcast.isPrivate}
      />
      <LinkActions url={podcastShareUrl(podcast)} title={podcast.title} />
    </>
  );
}

function useEpisodeClock(episode: IEpisodeInfo) {
  const [clock] = useState(() => {
    const player = usePlayer.getState();
    const current = sameEpisode(getCurrentEpisode(player), episode);
    return {
      position: current ? Math.floor(player.seekPosition) : 0,
      duration: (current && player.duration) || episode.duration || 0,
    };
  });
  return clock;
}

function EpisodeShare({
  episode,
  initialMode,
  initialChapter,
}: {
  episode: IEpisodeInfo;
  initialMode: Exclude<ShareMode, 'show'>;
  initialChapter?: number;
}) {
  const { t } = useTranslation();
  const { position, duration } = useEpisodeClock(episode);
  const chapters = playableChapters(useChapters(episode).chapters, duration);
  const [mode, setMode] = useState<ShareMode>(initialMode);
  const [start, setStart] = useState(position);
  const [range, setRange] = useState(() => ({
    start: position,
    end: duration
      ? Math.min(position + CLIP_SECONDS, Math.floor(duration))
      : position + CLIP_SECONDS,
  }));
  const [chapter, setChapter] = useState<number | undefined>(initialChapter);
  const selected =
    chapter ?? Math.max(currentChapterIndex(chapters, position), 0);
  const modes: ShareMode[] = [
    'show',
    'episode',
    'time',
    ...(chapters.length ? (['chapter'] as const) : []),
    'clip',
  ];
  const shown = modes.includes(mode) ? mode : 'episode';
  const moment = momentFor(shown, start, range, chapters, selected, duration);
  const url =
    shown === 'show'
      ? episode.podcastId
        ? podcastShareUrl({
            id: episode.podcastId,
            title: episode.podcastTitle ?? '',
            author: episode.author ?? '',
            cover: episode.cover,
            isPrivate: episode.isPrivate,
          })
        : null
      : episodeShareUrl(episode, moment);

  return (
    <>
      <div
        className={styles.modes}
        role="tablist"
        aria-label={t('share.modes')}
      >
        {modes.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={shown === item}
            onClick={() => setMode(item)}
          >
            {t(`share.${item}`)}
          </button>
        ))}
      </div>
      <Summary
        art={episode.episodeArt || episode.cover}
        title={shown === 'show' ? (episode.podcastTitle ?? '') : episode.title}
        detail={[
          shown === 'show' ? episode.author : episode.podcastTitle,
          duration ? formatDuration(t, duration) : null,
          shown === 'chapter'
            ? t('share.chapterCount', { count: chapters.length })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        privateSource={episode.isPrivate}
      />
      {shown === 'time' && (
        <StartPicker start={start} duration={duration} onChange={setStart} />
      )}
      {shown === 'chapter' && (
        <ChapterPicker
          chapters={chapters}
          duration={duration}
          selected={selected}
          onSelect={setChapter}
        />
      )}
      {shown === 'clip' && (
        <ClipTrimmer
          episode={episode}
          range={range}
          duration={duration}
          onChange={setRange}
        />
      )}
      <LinkActions
        url={url}
        title={episode.title}
        invalid={shown === 'clip' && range.end <= range.start}
        note={shown === 'clip' ? t('share.anyone') : undefined}
      />
    </>
  );
}

function momentFor(
  mode: ShareMode,
  start: number,
  range: { start: number; end: number },
  chapters: readonly Chapter[],
  selected: number,
  duration: number,
): Moment | undefined {
  switch (mode) {
    case 'time':
      return { kind: 'time', start };
    case 'clip':
      return { kind: 'clip', ...range };
    case 'chapter':
      return {
        kind: 'chapter',
        chapter: selected + 1,
        start: chapters[selected].start,
        end: chapterEnd(chapters, selected, duration),
      };
    default:
      return undefined;
  }
}

function Summary({
  art,
  title,
  detail,
  privateSource,
}: {
  art: string;
  title: string;
  detail: string;
  privateSource?: boolean;
}) {
  return (
    <div className={styles.summary}>
      <ProxiedImage
        alt=""
        src={art}
        privateSource={privateSource}
        sizes="48px"
      />
      <div>
        <p className={styles.summaryTitle}>{title}</p>
        <p className={styles.summaryDetail}>{detail}</p>
      </div>
    </div>
  );
}

function StartPicker({
  start,
  duration,
  onChange,
}: {
  start: number;
  duration: number;
  onChange: (start: number) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const last = duration ? Math.floor(duration) - 1 : Number.POSITIVE_INFINITY;
  const nudge = (seconds: number) =>
    onChange(Math.min(Math.max(start + seconds, 0), last));
  return (
    <div className={styles.start}>
      <div className={styles.startField}>
        <label htmlFor={id}>{t('share.startsAt')}</label>
        <TimeInput
          id={id}
          value={start}
          max={last}
          onChange={onChange}
          className={styles.startTime}
        />
        <small>{t('share.toEnd')}</small>
      </div>
      <button
        type="button"
        onClick={() => nudge(-NUDGE_SECONDS)}
        aria-label={t('share.earlier')}
      >
        −{NUDGE_SECONDS}
      </button>
      <button
        type="button"
        onClick={() => nudge(NUDGE_SECONDS)}
        aria-label={t('share.later')}
      >
        +{NUDGE_SECONDS}
      </button>
    </div>
  );
}

function ChapterPicker({
  chapters,
  duration,
  selected,
  onSelect,
}: {
  chapters: readonly Chapter[];
  duration: number;
  selected: number;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();
  const name = useId();
  return (
    <fieldset className={styles.chapters}>
      <legend className={styles.hidden}>{t('share.chapter')}</legend>
      {chapters.map((chapter, index) => {
        const length = chapterEnd(chapters, index, duration) - chapter.start;
        return (
          <label key={chapter.start} data-selected={index === selected}>
            <input
              type="radio"
              name={name}
              checked={index === selected}
              onChange={() => onSelect(index)}
            />
            <span className={styles.chapterStart}>
              {formatSecondsToTimestamp(chapter.start)}
            </span>
            <span className={styles.chapterTitle}>
              {chapter.title || t('chapters.untitled', { number: index + 1 })}
            </span>
            <span className={styles.chapterLength}>
              {length > 0 ? formatDuration(t, length) : ''}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function LinkActions({
  url,
  title,
  invalid,
  note,
}: {
  url: string | null;
  title: string;
  invalid?: boolean;
  note?: string;
}) {
  const { t } = useTranslation();
  const field = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState({ url, text: '' });
  const [native, setNative] = useState(false);
  useEffect(() => setNative(typeof navigator.share === 'function'), []);
  const status = failure.url === url ? failure.text : '';
  const setStatus = (text: string) => setFailure({ url, text });

  const copy = () => {
    if (!url) return;
    navigator.clipboard
      .writeText(url)
      .then(() => useToast.getState().showToast(t('share.copied')))
      .catch(() => {
        field.current?.select();
        setStatus(t('share.copyFailed'));
      });
  };
  const share = () => {
    if (!url) return;
    navigator.share({ title, url }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        setStatus(t('share.shareFailed'));
    });
  };

  return (
    <footer className={styles.footer}>
      <div className={styles.link}>
        <label className={styles.field}>
          <span className={styles.hidden}>{t('share.link')}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10 14a4 4 0 005.6 0l3-3a4 4 0 00-5.6-5.6l-1 1" />
            <path d="M14 10a4 4 0 00-5.6 0l-3 3a4 4 0 005.6 5.6l1-1" />
          </svg>
          <input
            ref={field}
            readOnly
            value={url ?? ''}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <button
          type="button"
          className={styles.copy}
          disabled={!url}
          onClick={copy}
        >
          {t('share.copy')}
        </button>
        {native && (
          <button
            type="button"
            className={styles.system}
            disabled={!url}
            onClick={share}
          >
            {t('share.system')}
          </button>
        )}
      </div>
      <p className={styles.note} role="status">
        {status || (invalid ? t('share.invalidRange') : note)}
      </p>
    </footer>
  );
}
