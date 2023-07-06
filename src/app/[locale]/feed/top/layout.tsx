import { i18n } from '@/i18.conf';

export async function generateStaticParams() {
  return i18n.locales.map((locale) => ({ locale }));
}

export default function Page({ children }: { children: React.ReactNode }) {
  return children;
}
