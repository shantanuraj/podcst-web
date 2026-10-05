'use client';

import { useMemo, useState } from 'react';
import { type Noteworthy as Item, useNoteworthy } from '@/data/discover';
import { useTranslation } from '@/shared/i18n';
import { getPodcastHref } from '@/shared/links';
import type { Genre } from '@/types';
import { ProxiedImage } from '@/ui/Image';
import { PageLink } from '@/ui/PageLink/PageLink';
import styles from './Discover.module.css';

const CHIPS = 6;

export function Noteworthy({
  locale,
  initial,
}: {
  locale: string;
  initial: Item[];
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<number | null>(null);
  const { data = [], isFetching } = useNoteworthy(locale, category, initial);
  const categories = useMemo(() => {
    const counts = new Map<number, { genre: Genre; count: number }>();
    for (const { category } of initial)
      if (category)
        counts.set(category.id, {
          genre: category,
          count: (counts.get(category.id)?.count ?? 0) + 1,
        });
    return [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, CHIPS)
      .map(({ genre }) => genre);
  }, [initial]);

  if (!initial.length) return null;
  return (
    <section className={styles.noteworthy} aria-busy={isFetching}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t('discover.noteworthy')}</h2>
        {categories.length > 1 && (
          <fieldset
            className={styles.chips}
            aria-label={t('discover.noteworthy')}
          >
            {[null, ...categories].map((genre) => (
              <button
                key={genre?.id ?? 'all'}
                type="button"
                aria-pressed={category === (genre?.id ?? null)}
                onClick={() => setCategory(genre?.id ?? null)}
              >
                {genre?.name ?? t('discover.all')}
              </button>
            ))}
          </fieldset>
        )}
      </div>
      <ul className={styles.grid}>
        {data.map((podcast) => (
          <li key={podcast.id}>
            <PageLink
              href={getPodcastHref(podcast)}
              loading="podcast"
              className={styles.tile}
            >
              <ProxiedImage
                alt=""
                src={podcast.cover}
                sizes="(max-width: 767px) 45vw, 180px"
                loading="lazy"
              />
              <span className={styles.tileTitle}>{podcast.title}</span>
              <span className={styles.meta}>{podcast.author}</span>
            </PageLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
