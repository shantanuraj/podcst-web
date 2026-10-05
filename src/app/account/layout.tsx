import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Account',
  robots: { index: false },
  alternates: { canonical: '/account' },
};

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
