/**
 * Subscriptions component
 */

import { h } from 'preact';

import { ISubscriptionsState } from '../stores/subscriptions';

import ImportPodcastsView from './ImportPodcastsView';
import PodcastsGrid from './PodcastsGrid';

interface ISubscriptionsProps extends ISubscriptionsState {
  theme: App.Theme;
}

const Subscriptions = ({ subs, theme }: ISubscriptionsProps) =>
  Object.keys(subs).length === 0 ? <ImportPodcastsView theme={theme} /> : <PodcastsGrid mode="subs" subs={subs} />;

export default Subscriptions;
