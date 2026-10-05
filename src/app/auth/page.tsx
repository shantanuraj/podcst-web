import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { top } from '@/app/api/top/top';
import { REGION_COOKIE, requestRegion } from '@/shared/region';
import { SignIn } from './SignIn';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false },
  alternates: { canonical: '/auth' },
};

const MOSAIC = 30;

export default async function AuthPage() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const region = requestRegion(
    cookieStore.get(REGION_COOKIE)?.value,
    headerStore.get('accept-language'),
  );
  const podcasts = await top(MOSAIC, region).catch(() => []);
  return <SignIn covers={podcasts.map(({ cover }) => cover)} />;
}
