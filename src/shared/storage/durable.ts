import { createStore, get, type UseStore, update } from 'idb-keyval';

export interface DurableStorage<T> {
  load(): Promise<T>;
  update(change: (state: T) => void): Promise<T>;
}

export function durableStorage<T>(
  name: string,
  initial: () => T,
  validate: (value: unknown) => value is T,
): DurableStorage<T> {
  let store: UseStore;
  const database = () => (store ??= createStore(name, 'state'));
  const decode = (value: unknown): T => {
    if (value === undefined) return initial();
    if (!validate(value))
      throw new Error('Saved data needs recovery; source retained.');
    return value;
  };
  return {
    load: async () => decode(await get('root', database())),
    update: async (change) => {
      let result: T;
      await update(
        'root',
        (value) => {
          result = decode(value);
          change(result);
          if (!validate(result)) throw new Error('Invalid durable state');
          return result;
        },
        database(),
      );
      return result!;
    },
  };
}
