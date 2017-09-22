/**
 * Storage manager
 */

const STORE_KEY = 'store@PLAY_PODCST_IO';

interface Storeable {
  subscriptions: SubscriptionsMap;
}

const storage = process.env.IN_BROWSER ?
  localStorage : {
    setItem(_k: string, _v: string) {},
    getItem(_k: string) { return '{}'; },
    clear(_x: string) {},
    length: 0,
  };

const getStore = (): Storeable => JSON.parse(storage.getItem(STORE_KEY) as string) || {};

const getValue = <K extends keyof Storeable>(key: K): Storeable[K] | null => {
  const store = getStore();
  return store[key] || null;
}

const setValue = <K extends keyof Storeable>(key: K, val: Storeable[K]) => {
  const store: Storeable = {
    ...getStore(),
    [key]: val,
  };
  storage.setItem(STORE_KEY, JSON.stringify(store));
}

export const Storage = {
  saveSubscriptions(subs: Storeable['subscriptions']) {
    setValue('subscriptions', subs);
  },
  getSubscriptions() {
    return getValue('subscriptions') || {};
  },
};
