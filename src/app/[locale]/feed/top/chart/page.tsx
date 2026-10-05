import type { Metadata } from 'next';
import Link from 'next/link';
import { top } from '@/app/api/top/top';
import { ItemListSchema } from '@/components/Schema';
import { translations } from '@/shared/i18n/server';
import { isRegion } from '@/shared/region';
import { ChartRows } from '@/ui/Discover/ChartRows';
import styles from '@/ui/Discover/Discover.module.css';

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const { t } = await translations();
  const url = `/${locale}/feed/top/chart`;
  const region = isRegion(locale) ? t(`regions.${locale}`) : locale;
  return {
    title: t('discover.chartTitle', { region }),
    openGraph: { url },
    alternates: { canonical: url },
  };
}

export default async function Page(props: PageProps) {
  const { locale } = await props.params;
  const { t } = await translations();
  const podcasts = await top(100, locale);
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
