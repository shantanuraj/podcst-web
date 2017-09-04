/**
 * Home component
 */

import {
  h,
} from 'preact';

import {
  SubscriptionsState,
} from '../stores/subscriptions';

interface HomeProps extends SubscriptionsState {
  parseOPML: (contents: string) => void;
}

import ImportPodcasts from './ImportPodcasts';
import PodcastsGrid from './PodcastsGrid';

const Home = ({
  parseOPML,
  subs,
}: HomeProps) => (
  Object.keys(subs).length === 0 ?
    <ImportPodcasts parseOPML={parseOPML} /> :
    <PodcastsGrid
      mode="subs"
      subs={subs}
    />
);

export default Home;
