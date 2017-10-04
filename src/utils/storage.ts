/**
 * Storage manager
 */

import {
  IAppState,
} from '../stores/app';

const STORE_KEY = 'store@PLAY_PODCST_IO';

interface IStoreable {
  subscriptions: SubscriptionsMap;
  app: IAppState;
}

const storage = process.env.IN_BROWSER ?
  localStorage : {
    // tslint:disable:no-empty
    setItem(_k: string, _v: string) {},
    getItem(_k: string) { return '{}'; },
    clear(_x: string) {},
    length: 0,
  };

const getStore = (): IStoreable => JSON.parse(storage.getItem(STORE_KEY) as string) || {};

const getValue = <K extends keyof IStoreable>(key: K): IStoreable[K] | null => {
  const store = getStore();
  return store[key] || null;
};

const setValue = <K extends keyof IStoreable>(key: K, val: IStoreable[K]) => {
  const store: IStoreable = {
    ...getStore(),
    [key]: val,
  };
  storage.setItem(STORE_KEY, JSON.stringify(store));
};

export const Storage = {
  saveSubscriptions(subs: IStoreable['subscriptions']) {
    setValue('subscriptions', subs);
  },
  getSubscriptions() {
    return getValue('subscriptions') || {};
  },
  saveAppState(appState: IAppState) {
    setValue('app', appState);
  },
  getAppState() {
    return getValue('app');
  },
};
