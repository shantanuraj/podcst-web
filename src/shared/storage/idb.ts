/**
 * IDB Storage manager
 */
import { del, get, set } from 'idb-keyval';
import type { ISubscriptionsMap } from '@/types';

export interface IIDBStoreable {
  subscriptions: ISubscriptionsMap;
}

export async function getValue<K extends keyof IIDBStoreable>(
  key: K,
): Promise<IIDBStoreable[K] | undefined> {
  try {
    const value = await get<IIDBStoreable[K]>(key);
    return value;
  } catch (err) {
    console.error('Could not retrieve key', key, err);
    return;
  }
}

export async function setValue<K extends keyof IIDBStoreable>(
  key: K,
  value: IIDBStoreable[K],
): Promise<void> {
  try {
    await set(key, value);
  } catch (err) {
    console.error('Could not set key', key, err);
  }
}

export async function removeValue<K extends keyof IIDBStoreable>(
  key: K,
): Promise<void> {
  try {
    await del(key);
  } catch (err) {
    console.error('Could not delete key', key, err);
  }
}
