import { useRouter } from 'next/router';
import { Fragment, useCallback } from 'react';

import { linkifyText } from '../../shared/link/linkify-text';
import { stripHost } from '../../shared/link/strip-host';
import { isSubscribed, useSubscriptions } from '../../shared/subscriptions/useSubscriptions';
import { IPodcastEpisodesInfo } from '../../types';
import { Button } from '../Button';
import { ShareButton } from '../Button/ShareButton';
import { ExternalLink } from '../ExternalLink';

import styles from './PodcastInfo.module.css';

type PodcastInfoProps = {
  info: IPodcastEpisodesInfo;
};

export function PodcastInfo({ info }: PodcastInfoProps) {
  const router = useRouter();
  const { title, author, cover, link, description } = info;
  const lastPublishedDate = info.episodes[0].published || info.published;
  const lastPublished = lastPublishedDate ? new Date(lastPublishedDate).toDateString() : null;

  return (
    <div className={styles.info}>
      <img loading="lazy" alt={`${title} by ${author}`} src={cover} />
      <div className={styles.text}>
        <h1>{title}</h1>
        <h2>
          {link ? (
            <Fragment>
              {author} - <ExternalLink href={link}>{stripHost(link)}</ExternalLink>
            </Fragment>
          ) : (
            author
          )}
        </h2>
        {lastPublished && <h5>Latest episode: {lastPublished}</h5>}
        <div className={styles.buttons}>
          <SubscribeButton info={info} />
          <ShareButton
            title={title}
            text={`Listen to ${title} by ${author} on Podcst`}
            url={router.asPath}
          />
        </div>
        <p
          className={styles.description}
          dangerouslySetInnerHTML={{ __html: linkifyText(description) }}
        />
      </div>
    </div>
  );
}

function SubscribeButton({ info }: PodcastInfoProps) {
  const feed = info.feed;
  const isSubscribedToFeed = useSubscriptions(useCallback(isSubscribed(feed), [feed]));
  const toggleSubscription = useSubscriptions(
    useCallback((state) => state.toggleSubscription, [feed]),
  );
  const onSubscribeClick = useCallback(() => toggleSubscription(info.feed, info), [info]);

  return (
    <Button
      data-is-subscribed={isSubscribedToFeed}
      onClick={onSubscribeClick}
      suppressHydrationWarning
    >
      {isSubscribedToFeed ? 'Unsubscribe' : 'Subscribe'}
    </Button>
  );
}
