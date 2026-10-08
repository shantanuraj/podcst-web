import { expect, test } from 'bun:test';
import vectors from '../../contracts/sharing/links.json';
import {
  formatShareTime,
  type Moment,
  parseShareUrl,
  type ShareTarget,
  shareUrl,
} from './share-link';

const number = (value: number | string) =>
  value === 'NaN' ? Number.NaN : Number(value);

for (const { seconds, expected } of vectors.format)
  test(`formats ${seconds} as ${expected}`, () => {
    expect(formatShareTime(seconds)).toBe(expected);
  });

for (const { name, target, expected } of vectors.generate)
  test(`generates ${name}`, () => {
    const moment = 'moment' in target ? target.moment : undefined;
    const shared: ShareTarget = {
      podcastId: target.podcastId,
      episodeId: 'episodeId' in target ? target.episodeId : undefined,
      moment:
        moment &&
        ({
          ...moment,
          start: number(moment.start),
          ...(moment.end === undefined ? {} : { end: number(moment.end) }),
        } as Moment),
    };
    expect(shareUrl(shared)).toBe(expected);
  });

for (const { url, expected } of vectors.parse)
  test(`parses ${url}`, () => {
    expect(parseShareUrl(url)).toEqual(expected as never);
  });
