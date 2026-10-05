import { expect, test } from 'bun:test';
import { cadence, movement } from './discovery';
import { plainText } from './plain-text';

test('movement compares the current position with the earlier rank', () => {
  expect(movement(0, undefined)).toBeNull();
  expect(movement(0, null)).toEqual({ kind: 'new' });
  expect(movement(1, 5)).toEqual({ kind: 'up', by: 3 });
  expect(movement(4, 2)).toEqual({ kind: 'down', by: 3 });
  expect(movement(2, 3)).toEqual({ kind: 'same' });
});

test('cadence needs eight recent episodes that mostly agree', () => {
  const day = 86_400_000;
  const wednesday = Date.UTC(2026, 8, 30, 10);
  expect(cadence([wednesday])).toBeNull();
  expect(
    cadence(
      Array.from({ length: 10 }, (_, week) => wednesday - week * 7 * day),
    ),
  ).toEqual({ kind: 'weekly', day: 3 });
  expect(
    cadence(Array.from({ length: 10 }, (_, index) => wednesday - index * day)),
  ).toEqual({ kind: 'daily' });
  expect(
    cadence(
      Array.from({ length: 10 }, (_, index) => wednesday - index * 3 * day),
    ),
  ).toBeNull();
});

test('plain text drops markup and decodes entities', () => {
  expect(
    plainText(
      '<p>Tom &amp; Jerry&#8217;s <b>chase</b>&nbsp;&#x2014; again</p>',
    ),
  ).toBe('Tom & Jerry’s chase — again');
});
