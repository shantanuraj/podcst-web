import { SpaLink } from '@/shared/spa';
import type { IEpisodeInfo, IPodcastEpisodesInfo } from '@/types';
import { PlayButton } from '@/ui/Button/PlayButton';
import { ShareButton } from '@/ui/Button/ShareButton';
import { ExternalLink } from '@/ui/ExternalLink';
import { Icon } from '@/ui/icons/svg/Icon';

import styles from './EpisodeInfo.module.css';
import { ShowNotes } from './ShowNotes';

type EpisodeInfoProps = {
  podcast: IPodcastEpisodesInfo;
  episode: IEpisodeInfo;
};

export function EpisodeInfo({ podcast, episode }: EpisodeInfoProps) {
  const { author, cover, episodeArt, published, summary, title } = episode;
  const showArt = episodeArt || cover;
  const shareTitle = `${podcast.title} - ${title}`;
  const releaseDate = published
    ? new Date(published).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <article className={styles.header}>
      <div className={styles.top}>
        <div className={styles.artwork}>
          <img loading="lazy" alt="" src={showArt} />
        </div>
        <div className={styles.meta}>
          <h1 className={styles.title}>
            {episode.link ? <ExternalLink href={episode.link}>{title}</ExternalLink> : title}
          </h1>
          <p className={styles.podcast}>
            <SpaLink href={`/episodes/${encodeURIComponent(podcast.feed)}`}>
              {podcast.title}
            </SpaLink>
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
