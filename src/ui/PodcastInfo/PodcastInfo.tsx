import { linkifyText } from '../../shared/link/linkify-text';
import { stripHost } from '../../shared/link/strip-host';
import { toggleSubscription } from '../../shared/subscriptions';
import { useSubscriptions } from '../../shared/subscriptions/useSubscriptions';
import { IPodcastEpisodesInfo } from '../../types';
import { Button } from '../Button';
import { ExternalLink } from '../ExternalLink';

import styles from './PodcastInfo.module.css';

type PodcastInfoProps = {
  info: IPodcastEpisodesInfo;
};

export function PodcastInfo({ info }: PodcastInfoProps) {
  const { title, author, cover, feed, link, description } = info;

  const { subs, dispatch } = useSubscriptions();

  const isSubscribed = feed in subs;
  const onSubscribeClick = () => dispatch(toggleSubscription(feed, info));

  return (
    <div className={styles.info}>
      <img loading="lazy" alt={`${title} by ${author}`} src={cover} />
      <div className={styles.text}>
        <h1>{title}</h1>
        <h2>
          {author} - <ExternalLink href={link}>{stripHost(link)}</ExternalLink>
        </h2>
        <div className={styles.buttons}>
          <Button data-is-subscribed={isSubscribed} onClick={onSubscribeClick}>
            {isSubscribed ? 'Unsubscribe' : 'Subscribe'}
          </Button>
          <Button>Share</Button>
        </div>
        <p
          className={styles.description}
          dangerouslySetInnerHTML={{ __html: linkifyText(description) }}
        />
      </div>
    </div>
  );
}
