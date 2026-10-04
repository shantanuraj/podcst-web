import { expect, test } from 'bun:test';
import vectors from '../../contracts/playback/shownotes.json';
import {
  chapterTarget,
  currentChapterIndex,
  showNoteChapters,
  timestampPattern,
  timestampSeconds,
  validTimeline,
} from './chapters';

for (const vector of vectors.chapters)
  test(`show-note chapters: ${vector.html}`, () =>
    expect(showNoteChapters(vector.html)).toEqual(vector.expected));
for (const vector of vectors.seconds)
  test(`timestamp: ${vector.timestamp}`, () =>
    expect(timestampSeconds(vector.timestamp)).toBe(vector.expected));
for (const vector of vectors.timestamps)
  test(`timestamp links: ${vector.text}`, () =>
    expect(
      [...vector.text.matchAll(timestampPattern)]
        .map(([value]) => value)
        .filter((value) => timestampSeconds(value) !== null),
    ).toEqual(vector.expected));

test('decodes HTML entities and discards scripts without rendering HTML', () => {
  expect(
    showNoteChapters(
      '<script>00:00 Wrong</script><p>00:00 &#8211; Start</p><p>01:00 &lt;b&gt;literal&lt;/b&gt;</p>',
    ),
  ).toEqual([
    { start: 0, title: 'Start' },
    { start: 60, title: '<b>literal</b>' },
  ]);
});

test('chapter boundaries and navigation follow source-time rules', () => {
  const chapters = [
    { start: 10, title: 'First' },
    { start: 30, title: 'Second' },
    { start: 90, title: 'Third' },
  ];
  expect(currentChapterIndex(chapters, 0)).toBe(-1);
  expect(currentChapterIndex(chapters, 30)).toBe(1);
  expect(currentChapterIndex(chapters, 100)).toBe(2);
  expect(currentChapterIndex(chapters, Number.NaN)).toBe(-1);
  expect(chapterTarget(chapters, 9, 'previous')).toBeNull();
  expect(chapterTarget(chapters, 10, 'previous')).toBe(10);
  expect(chapterTarget(chapters, 33, 'previous')).toBe(10);
  expect(chapterTarget(chapters, 33.001, 'previous')).toBe(30);
  expect(chapterTarget(chapters, 29.5, 'next')).toBe(90);
  expect(chapterTarget(chapters, 29.499, 'next')).toBe(30);
  expect(chapterTarget(chapters, 90, 'next')).toBeNull();
  expect(chapterTarget([], 0, 'next')).toBeNull();
  expect(chapterTarget([], 0, 'previous')).toBeNull();
  expect(
    validTimeline([
      { start: 0, title: '' },
      { start: Infinity, title: '' },
    ]),
  ).toBe(false);
});
