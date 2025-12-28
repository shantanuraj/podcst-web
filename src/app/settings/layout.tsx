import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings',
  openGraph: {
    url: '/settings',
  },
  alternates: {
    canonical: '/settings',
  },
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
