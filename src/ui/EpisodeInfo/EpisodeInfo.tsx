import { localeForLanguage } from '@/messages';
import { translations } from '@/shared/i18n/server';
import { getPodcastHref } from '@/shared/links';
import { formatDuration } from '@/shared/player/formatTime';
import type { Moment } from '@/shared/share-link';
import type { IEpisodeInfo, IPodcastInfo } from '@/types';
import { ArtworkBackdrop } from '@/ui/ArtworkBackdrop/ArtworkBackdrop';
import { ProxiedImage } from '@/ui/Image';
import { PageLink } from '@/ui/PageLink/PageLink';

import { Chapters } from './Chapters';
import { EpisodeActions } from './EpisodeActions';
import styles from './EpisodeInfo.module.css';
import { ClipActions, PlayFromTime, SharedEyebrow } from './SharedMoment';
import { ShowNotes } from './ShowNotes';

export async function EpisodeInfo({
  podcast,
  episode,
  moment = null,
  invalidMoment = false,
}: {
  podcast: IPodcastInfo;
  episode: IEpisodeInfo;
  moment?: Moment | null;
  invalidMoment?: boolean;
}) {
  const { t, language } = await translations();
  const locale = localeForLanguage[language];
  const art = episode.episodeArt || episode.cover;
  const dateline = [
    episode.published
      ? new Date(episode.published).toLocaleDateString(locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : null,
    episode.duration ? formatDuration(t, episode.duration) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className={styles.episode}>
      <ArtworkBackdrop
        src={art}
        privateSource={episode.isPrivate}
        className={styles.tint}
      />
      <div className={styles.page}>
        <nav className={styles.crumbs} aria-label={podcast.title}>
          <PageLink href={getPodcastHref(podcast)} loading="podcast">
            {podcast.title}
          </PageLink>
        </nav>
        <header className={styles.hero}>
          <div className={styles.artwork}>
            <ProxiedImage
              loading="eager"
              fetchPriority="high"
              alt=""
              src={art}
              privateSource={episode.isPrivate}
              sizes="(max-width: 767px) 140px, 200px"
            />
          </div>
          <div className={styles.meta}>
            {moment ? (
              <SharedEyebrow episode={episode} moment={moment} />
            ) : (
              dateline && <p className={styles.eyebrow}>{dateline}</p>
            )}
            <h1 className={styles.title}>{episode.title}</h1>
            {moment && <p className={styles.byline}>{dateline}</p>}
            {invalidMoment && (
              <p className={styles.unavailable} role="status">
                {t('share.unavailable')}
              </p>
            )}
            {moment && moment.kind !== 'time' ? (
              <ClipActions
                podcast={podcast}
                episode={episode}
                moment={moment}
              />
            ) : (
              <EpisodeActions
                episode={episode}
                leading={
                  moment && (
                    <PlayFromTime episode={episode} start={moment.start} />
                  )
                }
              />
            )}
          </div>
        </header>
        <div className={styles.body}>
          <ShowNotes className={styles.notes} episode={episode} />
          <Chapters
            episode={episode}
            shared={moment?.kind === 'time' ? undefined : (moment ?? undefined)}
          />
        </div>
      </div>
    </article>
  );
}
