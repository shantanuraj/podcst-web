import { expect, test } from 'bun:test';
import vectors from '../../contracts/playback/releases.json';
import { newReleases, releaseSections } from './releases';

type Vector = { id: string; published: string | null };
const dated = ({ id, published }: Vector) => ({
  id,
  published: published === null ? null : Date.parse(published),
});

test.each(vectors.newReleases)('new releases: $name', (vector) => {
  expect(
    newReleases(
      vector.podcasts.map((podcast) => ({
        episodes: (podcast.episodes as Vector[]).map(dated),
      })),
    ).map(({ id }) => id),
  ).toEqual(vector.expected);
});

test.each(vectors.sections)('release sections: $name', (vector) => {
  expect(
    releaseSections(
      (vector.episodes as Vector[]).map(dated),
      Date.parse(vector.now),
      'en-US',
      {
        today: 'Today',
        yesterday: 'Yesterday',
        unavailable: 'Date unavailable',
      },
    ).map(({ day, title, recent, episodes }) => ({
      day,
      title,
      recent,
      episodes: episodes.map(({ id }) => id),
    })),
  ).toEqual(vector.expected);
});
