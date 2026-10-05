import { releases } from '../../contracts/playback/rules.json';

const DAY = 86_400_000;
const RECENT_DAYS = 7;

type Dated = { published: number | null };

const newestFirst = (a: Dated, b: Dated) =>
  (b.published ?? Number.NEGATIVE_INFINITY) -
  (a.published ?? Number.NEGATIVE_INFINITY);

export function newReleases<T extends Dated>(
  podcasts: readonly { episodes: readonly T[] }[],
): T[] {
  return podcasts
    .flatMap(({ episodes }) =>
      [...episodes].sort(newestFirst).slice(0, releases.perPodcast),
    )
    .sort(newestFirst);
}

export interface ReleaseSection<T> {
  day: string | null;
  title: string;
  recent: boolean;
  episodes: T[];
}

export interface SectionLabels {
  today: string;
  yesterday: string;
  unavailable: string;
}

const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);

export function releaseSections<T extends Dated>(
  episodes: readonly T[],
  now: number,
  locale: Intl.LocalesArgument,
  labels: SectionLabels,
): ReleaseSection<T>[] {
  const today = Date.parse(utcDay(now));
  const sections = new Map<string | null, ReleaseSection<T>>();
  for (const episode of episodes) {
    const day = episode.published === null ? null : utcDay(episode.published);
    let section = sections.get(day);
    if (!section) {
      const age = day === null ? null : (today - Date.parse(day)) / DAY;
      const recent = age !== null && age >= 0 && age < RECENT_DAYS;
      section = {
        day,
        recent,
        title:
          day === null
            ? labels.unavailable
            : age === 0
              ? labels.today
              : age === 1
                ? labels.yesterday
                : new Date(Date.parse(day)).toLocaleDateString(
                    locale,
                    recent
                      ? { weekday: 'long', timeZone: 'UTC' }
                      : {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                          timeZone: 'UTC',
                        },
                  ),
        episodes: [],
      };
      sections.set(day, section);
    }
    section.episodes.push(episode);
  }
  return [...sections.values()];
}
