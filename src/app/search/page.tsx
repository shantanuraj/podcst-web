import type { Metadata } from 'next';
import { SearchResults } from './SearchResults';

export const metadata: Metadata = {
  title: 'Search',
  robots: { index: false },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const term = (Array.isArray(q) ? q[0] : q)?.trim() ?? '';
  return <SearchResults key={term} term={term} />;
}
