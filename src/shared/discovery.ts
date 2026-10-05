export type Movement =
  | { kind: 'up' | 'down'; by: number }
  | { kind: 'same' | 'new' };

export function movement(
  index: number,
  previousRank: number | null | undefined,
): Movement | null {
  if (previousRank === undefined) return null;
  if (previousRank === null) return { kind: 'new' };
  const by = previousRank - (index + 1);
  return by > 0
    ? { kind: 'up', by }
    : by < 0
      ? { kind: 'down', by: -by }
      : { kind: 'same' };
}

const DAY = 86_400_000;
const SAMPLE = 8;
const AGREEMENT = 6;

export type Cadence = { kind: 'daily' } | { kind: 'weekly'; day: number };

export function cadence(published: readonly (number | null)[]): Cadence | null {
  const dates = published
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => b - a)
    .slice(0, SAMPLE);
  if (dates.length < SAMPLE) return null;
  const gaps = dates.slice(1).map((date, index) => dates[index] - date);
  if (gaps.filter((gap) => gap <= 1.5 * DAY).length >= AGREEMENT - 1)
    return { kind: 'daily' };
  const days = dates.map((date) => new Date(date).getUTCDay());
  const counts = new Map<number, number>();
  for (const day of days) counts.set(day, (counts.get(day) ?? 0) + 1);
  const [day, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return count >= AGREEMENT ? { kind: 'weekly', day } : null;
}
