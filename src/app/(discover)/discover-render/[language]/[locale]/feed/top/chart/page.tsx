import type { Metadata } from 'next';
import Link from 'next/link';
import { ItemListSchema } from '@/components/Schema';
import { getTopPodcasts } from '@/server/ingest/top';
import { translationsForLanguage } from '@/shared/i18n/server';
import { isRegion } from '@/shared/region';
import { ChartRows } from '@/ui/Discover/ChartRows';
import styles from '@/ui/Discover/Discover.module.css';

type PageProps = {
  params: Promise<{ language: string; locale: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, language } = await params;
  const { t } = translationsForLanguage(language);
  const url = `/${locale}/feed/top/chart`;
  const region = isRegion(locale) ? t(`regions.${locale}`) : locale;
  return {
    title: t('discover.chartTitle', { region }),
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
  const { t } = translationsForLanguage(language);
  const podcasts = await getTopPodcasts(100, locale);
  const region = isRegion(locale) ? t(`regions.${locale}`) : locale;
  return (
    <div className={`${styles.page} ${styles.chartPage}`}>
      <ItemListSchema items={podcasts} title={t('feed.topPodcasts')} />
      <div className={styles.dateline}>
        <Link href={`/${locale}/feed/top`}>{t('nav.discover')}</Link>
        <span>{t('discover.dateline', { region })}</span>
      </div>
      <div className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>
          {t('discover.chartTitle', { region })}
        </h1>
      </div>
      <ChartRows podcasts={podcasts} offset={0} />
    </div>
  );
}
