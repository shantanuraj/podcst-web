import type { Metadata } from 'next';
import { top } from '@/app/api/top/top';
import { ItemListSchema } from '@/components/Schema';
import { PodcastsGrid } from '@/ui/PodcastsGrid';

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const url = `/${locale}/feed/top`;
  return {
    title: 'Top Podcasts',
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
  const podcasts = await top(100, locale);
  return (
    <>
      <ItemListSchema items={podcasts} title="Top Podcasts" />
      <PodcastsGrid podcasts={podcasts} title="Trending" />
    </>
  );
}
