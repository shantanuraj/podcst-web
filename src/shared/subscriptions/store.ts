import { IPodcastEpisodesInfo } from '../../types';
import { Subscriptions } from './context';

export const addSubscription = (feed: string, info: IPodcastEpisodesInfo) =>
  ({ type: 'ADD_SUBSCRIPTION', feed, info } as const);
export const removeSubscription = (feed: string) =>
  ({ type: 'REMOVE_SUBSCRIPTION', feed } as const);
export const toggleSubscription = (feed: string, info: IPodcastEpisodesInfo) =>
  ({ type: 'TOGGLE_SUBSCRIPTION', feed, info } as const);

export type SubscriptionsAction =
  | ReturnType<typeof addSubscription>
  | ReturnType<typeof removeSubscription>
  | ReturnType<typeof toggleSubscription>;

export function subscriptionsReducer(
  state: Subscriptions['subs'],
  action: SubscriptionsAction,
): Subscriptions['subs'] {
  switch (action.type) {
    case 'ADD_SUBSCRIPTION': {
      const { feed, info } = action;
      return { ...state, [feed]: info };
    }
    case 'REMOVE_SUBSCRIPTION': {
      return Object.fromEntries(Object.entries(state).filter(([feed]) => feed !== action.feed));
    }
    case 'TOGGLE_SUBSCRIPTION': {
      const { feed, info } = action;
      const isSubscribed = state[feed];
      return isSubscribed
        ? Object.fromEntries(Object.entries(state).filter(([feed]) => feed !== action.feed))
        : { ...state, [feed]: info };
    }
    default: {
      throw new Error(`Unsupported action type: ${(action as SubscriptionsAction).type}`);
    }
  }
}
