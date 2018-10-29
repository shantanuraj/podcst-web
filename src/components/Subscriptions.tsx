/**
 * Subscriptions component
 */

import * as React from 'react';

import { ISubscriptionsState } from '../stores/subscriptions';

import ImportPodcastsView from './ImportPodcastsView';
import PodcastsGrid from './PodcastsGrid';

import { App } from '../typings';

interface ISubscriptionsProps extends ISubscriptionsState {
  theme: App.ITheme;
  themeMode: App.ThemeMode;
}

const Subscriptions = ({ subs, theme, themeMode }: ISubscriptionsProps) => {
  return Object.keys(subs).length === 0 ? (
    <ImportPodcastsView theme={theme} />
  ) : (
    <PodcastsGrid mode="subs" subs={subs} themeMode={themeMode} />
  );
};

export default Subscriptions;
