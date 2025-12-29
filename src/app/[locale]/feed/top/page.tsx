import type { Metadata } from 'next';
import { top } from '@/app/api/top/top';
import { ItemListSchema } from '@/components/Schema';
import { translations } from '@/shared/i18n/server';
import { PodcastsGrid } from '@/ui/PodcastsGrid';

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const { t } = await translations();
  const url = `/${locale}/feed/top`;
  return {
    title: t('feed.topPodcasts'),
    openGraph: {
      url,
    },
    alternates: {
      canonical: url,
    },
  };
}

export default async function Page(props: PageProps) {
  const { locale } = await props.params;
  const { t } = await translations();
  const podcasts = await top(100, locale);
  return (
    <>
      <ItemListSchema items={podcasts} title={t('feed.topPodcasts')} />
      <PodcastsGrid podcasts={podcasts} title={t('feed.trending')} />
    </>
  );
}
