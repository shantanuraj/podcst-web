import { isCanonicalId } from '../../src/shared/canonical-id';

export function fixtureLabel(value: unknown): number {
  if (!isCanonicalId(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('Expected a small synthetic canonical ID');
  return Number(value);
}

export function fixtureId(value: string | number): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? String(value)
    : (value as string);
}

export function withFixtureListingId<Client, Args extends unknown[], Result>(
  operation: (
    client: Client,
    feed: string,
    id?: string,
    ...args: Args
  ) => Result,
) {
  return (client: Client, feed: string, id?: string | number, ...args: Args) =>
    operation(
      client,
      feed,
      id === undefined ? undefined : fixtureId(id),
      ...args,
    );
}

export function withFixtureId<Client, Args extends unknown[], Result>(
  operation: (client: Client, id: string, ...args: Args) => Result,
) {
  return (client: Client, id: string | number, ...args: Args) =>
    operation(client, fixtureId(id), ...args);
}
