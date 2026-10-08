import { SubscribeButton } from '@/components/SubscribeButton/SubscribeButton';
import { localeForLanguage } from '@/messages';
import { cadence } from '@/shared/discovery';
import { translations } from '@/shared/i18n/server';
import { linkifyText } from '@/shared/link/linkify-text';
import { stripHost } from '@/shared/link/strip-host';
import type { IEpisodeInfo, IPodcastInfo } from '@/types';
import { ArtworkBackdrop } from '@/ui/ArtworkBackdrop/ArtworkBackdrop';
import { PlayButton } from '@/ui/Button/PlayButton';
import { ShareButton } from '@/ui/Button/ShareButton';
import { ExternalLink } from '@/ui/ExternalLink';
import { ProxiedImage } from '@/ui/Image';

import styles from './PodcastInfo.module.css';

export async function PodcastInfo({
  podcast,
  episodes,
}: {
  podcast: IPodcastInfo;
  episodes: readonly IEpisodeInfo[];
}) {
  const { title, author, cover, link, description } = podcast;
  const { t, language } = await translations();
  const locale = localeForLanguage[language];
  const rhythm = cadence(episodes.map(({ published }) => published));
  const schedule =
    rhythm?.kind === 'daily'
      ? t('podcast.daily')
      : rhythm?.kind === 'weekly'
        ? t('podcast.weekly', {
            day: new Date(Date.UTC(2026, 0, 4 + rhythm.day)).toLocaleDateString(
              locale,
              { weekday: 'long', timeZone: 'UTC' },
            ),
          })
        : null;
  const since = podcast.firstPublished
    ? new Date(podcast.firstPublished).getFullYear()
    : null;
  const latest = episodes[0];

  return (
    <header className={styles.header}>
      <ArtworkBackdrop
        src={cover}
        privateSource={podcast.isPrivate}
        className={styles.tint}
      />
      <div className={styles.hero}>
        <div className={styles.artwork}>
          <ProxiedImage
            loading="eager"
            fetchPriority="high"
            alt=""
            src={cover}
            privateSource={podcast.isPrivate}
            sizes="(max-width: 767px) 160px, 260px"
          />
        </div>
        <div className={styles.meta}>
          {(podcast.category || schedule) && (
            <p className={styles.eyebrow}>
              {[podcast.category?.name, schedule].filter(Boolean).join(' · ')}
            </p>
          )}
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.author}>{author}</p>
          <div className={styles.actions}>
            <SubscribeButton info={{ ...podcast, episodes: [] }} />
            {latest && (
              <PlayButton episode={latest} label={t('discover.playLatest')} />
            )}
            <ShareButton
              request={{
                mode: 'show',
                podcast: {
                  id: podcast.id,
                  title,
                  author,
                  cover,
                  isPrivate: podcast.isPrivate,
                },
              }}
            />
          </div>
        </div>
        <div className={styles.about}>
          {description && (
            <div
              className={styles.description}
              dangerouslySetInnerHTML={{ __html: linkifyText(description) }}
            />
          )}
          <p className={styles.facts}>
            <span>
              {t('podcast.episodeCount', { count: podcast.episodeCount })}
            </span>
            {since && <span>{t('podcast.since', { year: since })}</span>}
            {link && (
              <ExternalLink href={link} className={styles.link}>
                {stripHost(link)} ↗
              </ExternalLink>
            )}
            {!podcast.isPrivate && (
              <a href={podcast.feed} className={styles.link}>
                RSS
              </a>
            )}
          </p>
        </div>
      </div>
    </header>
  );
}
