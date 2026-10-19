import type { Metadata } from 'next';
import Link from 'next/link';
import { ItemListSchema } from '@/components/Schema';
import { localeForLanguage } from '@/messages';
import { getDiscover } from '@/server/discover';
import { translationsForLanguage } from '@/shared/i18n/server';
import { isRegion } from '@/shared/region';
import { ChartRows } from '@/ui/Discover/ChartRows';
import styles from '@/ui/Discover/Discover.module.css';
import { LeadStory } from '@/ui/Discover/LeadStory';
import { Noteworthy } from '@/ui/Discover/Noteworthy';

type PageProps = {
  params: Promise<{ language: string; locale: string }>;
};

const CHART_ROWS = 7;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, language } = await params;
  const { t } = translationsForLanguage(language);
  const url = `/${locale}/feed/top`;
  return {
    title: t('feed.topPodcasts'),
    openGraph: {
      url,
      images: [
        {
          url: `/${locale}/feed/top/opengraph-image`,
          width: 1200,
          height: 630,
        },
      ],
    },
    twitter: { images: [`/${locale}/feed/top/twitter-image`] },
    alternates: { canonical: url },
  };
}

export default async function Page(props: PageProps) {
  const { locale, language } = await props.params;
  const { t, language: uiLanguage } = translationsForLanguage(language);
  const { podcasts, worthy, lead, latest } = await getDiscover(locale);
  const today = new Date().toLocaleDateString(localeForLanguage[uiLanguage], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const region = isRegion(locale) ? t(`regions.${locale}`) : locale;

  return (
    <div className={styles.page}>
      <ItemListSchema items={podcasts} title={t('feed.topPodcasts')} />
      <div className={styles.dateline}>
        <span>{today}</span>
        <span>{t('discover.dateline', { region })}</span>
      </div>
      <div className={styles.front}>
        {lead && <LeadStory podcast={lead} latest={latest} />}
        <section>
          <div className={styles.sectionHead}>
            <h1 className={styles.sectionTitle}>{t('discover.chart')}</h1>
            <Link href={`/${locale}/feed/top/chart`} className={styles.seeAll}>
              {t('discover.seeAll', { count: podcasts.length })}
            </Link>
          </div>
          <ChartRows podcasts={podcasts.slice(1, 1 + CHART_ROWS)} offset={1} />
        </section>
      </div>
      <Noteworthy locale={locale} initial={worthy} />
    </div>
  );
}
