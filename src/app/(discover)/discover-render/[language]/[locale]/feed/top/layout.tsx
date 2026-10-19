import { notFound } from 'next/navigation';
import { isValidLanguage } from '@/shared/i18n/shared';
import { isRegion } from '@/shared/region';

export const dynamic = 'force-static';
export const revalidate = 900;

// Generate on first request so the image build never needs a database.
export function generateStaticParams() {
  return [];
}

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ language: string; locale: string }>;
}) {
  const { language, locale } = await params;
  if (!isValidLanguage(language) || !isRegion(locale)) notFound();
  return children;
}
