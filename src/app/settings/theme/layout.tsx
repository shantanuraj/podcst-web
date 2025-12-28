import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Theme',
  openGraph: {
    url: '/settings/theme',
  },
  alternates: {
    canonical: '/settings/theme',
  },
};

export default function ThemeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
