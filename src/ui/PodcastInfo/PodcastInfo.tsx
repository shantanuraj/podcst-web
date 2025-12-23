import { SubscribeButton } from '@/components/SubscribeButton/SubscribeButton';
import { linkifyText } from '@/shared/link/linkify-text';
import { stripHost } from '@/shared/link/strip-host';
import type { IPodcastEpisodesInfo } from '@/types';
import { ShareButton } from '@/ui/Button/ShareButton';
import { ExternalLink } from '@/ui/ExternalLink';
import { Icon } from '@/ui/icons/svg/Icon';

import styles from './PodcastInfo.module.css';

export interface PodcastInfoProps {
  info: IPodcastEpisodesInfo;
}

export function PodcastInfo({ info }: PodcastInfoProps) {
  const { title, author, cover, link, description } = info;
  const lastPublishedDate = info.episodes?.[0]?.published || info.published;
  const lastPublished = lastPublishedDate
    ? new Date(lastPublishedDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <header className={styles.header}>
      <div className={styles.top}>
        <div className={styles.artwork}>
          <img loading="lazy" alt="" src={cover} />
        </div>
        <div className={styles.meta}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.author}>
            {author}
            {link && (
              <>
                {' · '}
                <ExternalLink href={link}>
                  {stripHost(link)}
                  <Icon icon="external-link" size={14} />
                </ExternalLink>
              </>
            )}
          </p>
          {lastPublished && <p className={styles.lastUpdated}>Updated {lastPublished}</p>}
          <div className={styles.actions}>
            <SubscribeButton info={info} />
            <ShareButton title={title} text={`Listen to ${title} by ${author} on Podcst`} />
          </div>
        </div>
      </div>
      {description && (
        <div
          className={styles.description}
          dangerouslySetInnerHTML={{ __html: linkifyText(description) }}
        />
      )}
    </header>
  );
}
