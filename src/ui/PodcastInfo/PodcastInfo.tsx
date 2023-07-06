import { Fragment } from 'react';

import { SubscribeButton } from '@/components/SubscribeButton/SubscribeButton';
import { linkifyText } from '@/shared/link/linkify-text';
import { stripHost } from '@/shared/link/strip-host';
import { IPodcastEpisodesInfo } from '@/types';
import { ShareButton } from '@/ui/Button/ShareButton';
import { ExternalLink } from '@/ui/ExternalLink';
import { Icon } from '@/ui/icons/svg/Icon';

import styles from './PodcastInfo.module.css';

export interface PodcastInfoProps {
  info: IPodcastEpisodesInfo;
}

export function PodcastInfo({ info }: PodcastInfoProps) {
  const { title, author, cover, link, description } = info;
  const lastPublishedDate = info.episodes?.[0].published || info.published;
  const lastPublished = lastPublishedDate ? new Date(lastPublishedDate).toDateString() : null;

  return (
    <div className={styles.info}>
      <img loading="lazy" alt={`${title} by ${author}`} src={cover} />
      <div className={styles.text}>
        <h1>{title}</h1>
        <h2>
          {link ? (
            <Fragment>
              {author} -{' '}
              <ExternalLink href={link} title="Visit podcast website">
                {stripHost(link)} <Icon icon="external-link" size={18} />
              </ExternalLink>
            </Fragment>
          ) : (
            author
          )}
        </h2>
        {lastPublished && <h5>Latest episode: {lastPublished}</h5>}
        <div className={styles.buttons}>
          <SubscribeButton info={info} />
          <ShareButton title={title} text={`Listen to ${title} by ${author} on Podcst`} />
        </div>
        <div
          className={styles.description}
          dangerouslySetInnerHTML={{ __html: linkifyText(description) }}
        />
      </div>
    </div>
  );
}
