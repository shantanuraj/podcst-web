import schema from '../../contracts/state/schema.json';

const identity = schema.definitions.id;
const decimal = new RegExp(identity.pattern);

export function isCanonicalId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= identity.maxLength &&
    decimal.test(value)
  );
}

export const compareCanonicalIds = (a: string, b: string) =>
  BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;

export function migrateStoredId(
  value: unknown,
): { canonicalId: string } | { unresolved: unknown } {
  if (isCanonicalId(value)) return { canonicalId: value };
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    return { canonicalId: String(value) };
  return { unresolved: value };
}
