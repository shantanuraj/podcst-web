/**
 * Home component
 */

import {
  h,
} from 'preact';

import {
  ISubscriptionsState,
} from '../stores/subscriptions';

import ImportPodcastsView from './ImportPodcastsView';
import PodcastsGrid from './PodcastsGrid';

interface IHomeProps extends ISubscriptionsState {
  theme: App.Theme;
}

const Home = ({
  subs,
  theme,
}: IHomeProps) => (
  Object.keys(subs).length === 0 ?
    <ImportPodcastsView theme={theme} /> :
    <PodcastsGrid
      mode="subs"
      subs={subs}
    />
);

export default Home;
