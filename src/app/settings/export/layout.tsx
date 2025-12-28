import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Export',
  openGraph: {
    url: '/settings/export',
  },
  alternates: {
    canonical: '/settings/export',
  },
};

export default function ExportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
