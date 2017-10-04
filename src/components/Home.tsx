/**
 * Home component
 */

import {
  h,
} from 'preact';

import {
  ISubscriptionsState,
} from '../stores/subscriptions';

import ImportPodcasts from './ImportPodcasts';
import PodcastsGrid from './PodcastsGrid';

interface IHomeProps extends ISubscriptionsState {
  parseOPML: (contents: string) => void;
  theme: App.Theme;
}

const Home = ({
  parseOPML,
  subs,
  theme,
}: IHomeProps) => (
  Object.keys(subs).length === 0 ?
    <ImportPodcasts theme={theme} parseOPML={parseOPML} /> :
    <PodcastsGrid
      mode="subs"
      subs={subs}
    />
);

export default Home;
