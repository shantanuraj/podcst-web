import { IEpisodeInfo, IPodcastEpisodesInfo } from '../../types';
import { PlayButton } from '../Button/PlayButton';
import { ShareButton } from '../Button/ShareButton';
import { ExternalLink } from '../ExternalLink';
import { Icon } from '../icons/svg/Icon';

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
  const releaseDate = published ? new Date(published).toDateString() : null;

  return (
    <div className={styles.info}>
      <img loading="lazy" alt={`${title} by ${author}`} src={showArt} />
      <div className={styles.text}>
        <h1>{episode.link ? <ExternalLink href={episode.link}>{title}</ExternalLink> : title}</h1>
        <h2>
          from{' '}
          <ExternalLink href={podcast.link} title="Visit podcast website">
            {podcast.title} <Icon icon="external-link" size={18} />
          </ExternalLink>
        </h2>
        <h2>by {author}</h2>
        {releaseDate && <h5>Published: {releaseDate}</h5>}
        <div className={styles.buttons}>
          <PlayButton episode={episode} />
          <ShareButton
            text={(summary && `${shareTitle}\n${summary}`) || shareTitle}
            title={shareTitle}
          />
        </div>
        <ShowNotes className={styles.episodeNotes} episode={episode} />
      </div>
    </div>
  );
}
