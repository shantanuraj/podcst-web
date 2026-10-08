import { expect, test } from 'bun:test';
import { type ProgressEvent, progressIntent } from './progress-intent';

for (const position of [0, 94, 95, 100])
  test(`checkpoint at ${position} seconds explicitly preserves completion on the wire`, () => {
    const change = progressIntent('checkpoint', position);
    expect(change).toEqual({ positionSeconds: position, completed: null });
    expect(JSON.stringify(change)).toContain('"completed":null');
  });
for (const [event, position, completed] of [
  ['played', 0, true],
  ['ended', 100, true],
  ['replay', 12, false],
  ['unplayed', 100, false],
] as const)
  test(`${event} remains an explicit boolean intent`, () => {
    expect(progressIntent(event as ProgressEvent, position)).toEqual({
      positionSeconds: event === 'unplayed' ? 0 : position,
      completed,
    });
  });
for (const position of [-1, 0.5, NaN, Infinity, 2147483648])
  test(`invalid checkpoint position ${position} is rejected`, () => {
    expect(() => progressIntent('checkpoint', position)).toThrow(
      'Invalid source position',
    );
  });
