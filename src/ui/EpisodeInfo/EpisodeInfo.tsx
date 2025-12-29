import Link from 'next/link';
import { localeForLanguage } from '@/messages';
import { translations } from '@/shared/i18n/server';
import { getPodcastHref } from '@/shared/links';
import type { IEpisodeInfo, IPodcastEpisodesInfo } from '@/types';
import { PlayButton } from '@/ui/Button/PlayButton';
import { ShareButton } from '@/ui/Button/ShareButton';
import { ExternalLink } from '@/ui/ExternalLink';
import { ProxiedImage } from '@/ui/Image';
import { Icon } from '@/ui/icons/svg/Icon';

import styles from './EpisodeInfo.module.css';
import { ShowNotes } from './ShowNotes';

type EpisodeInfoProps = {
  podcast: IPodcastEpisodesInfo;
  episode: IEpisodeInfo;
};

export async function EpisodeInfo({ podcast, episode }: EpisodeInfoProps) {
  const { author, cover, episodeArt, published, summary, title } = episode;
  const { language } = await translations();
  const locale = localeForLanguage[language];
  const showArt = episodeArt || cover;
  const shareTitle = `${podcast.title} - ${title}`;
  const releaseDate = published
    ? new Date(published).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <article className={styles.header}>
      <div className={styles.top}>
        <div className={styles.artwork}>
          <ProxiedImage loading="lazy" alt="" src={showArt} />
        </div>
        <div className={styles.meta}>
          <h1 className={styles.title}>
            {episode.link ? (
              <ExternalLink href={episode.link}>{title}</ExternalLink>
            ) : (
              title
            )}
          </h1>
          <p className={styles.podcast}>
            <Link href={getPodcastHref(podcast)}>{podcast.title}</Link>
            {podcast.link && (
              <ExternalLink href={podcast.link}>
                <Icon icon="external-link" size={14} />
              </ExternalLink>
            )}
          </p>
          <p className={styles.author}>{author}</p>
          {releaseDate && <p className={styles.published}>{releaseDate}</p>}
          <div className={styles.actions}>
            <PlayButton episode={episode} />
            <ShareButton
              text={(summary && `${shareTitle}\n${summary}`) || shareTitle}
              title={shareTitle}
            />
          </div>
        </div>
      </div>
      <ShowNotes className={styles.showNotes} episode={episode} />
    </article>
  );
}
