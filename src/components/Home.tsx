/**
 * Home component
 */

import {
  h,
} from 'preact';

import {
  SubscriptionsState,
} from '../stores/subscriptions';

import ImportPodcasts from './ImportPodcasts';
import PodcastsGrid from './PodcastsGrid';

interface HomeProps extends SubscriptionsState {
  parseOPML: (contents: string) => void;
  theme: App.Theme;
}

const Home = ({
  parseOPML,
  subs,
  theme,
}: HomeProps) => (
  Object.keys(subs).length === 0 ?
    <ImportPodcasts theme={theme} parseOPML={parseOPML} /> :
    <PodcastsGrid
      mode="subs"
      subs={subs}
    />
);

export default Home;
