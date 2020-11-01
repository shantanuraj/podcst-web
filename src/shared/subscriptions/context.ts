import { createContext, Dispatch } from 'react';
import { IPodcastEpisodesInfo } from '../../types';
import { SubscriptionsAction } from './store';

export type Subscriptions = {
  subs: { [feed: string]: IPodcastEpisodesInfo };
  dispatch: Dispatch<SubscriptionsAction>;
};

export const SubscriptionsContext = createContext<Subscriptions>({
  subs: {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  dispatch: () => {},
});

SubscriptionsContext.displayName = 'SubscriptionsContext';
