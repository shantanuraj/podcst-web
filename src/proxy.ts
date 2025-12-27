import { match as matchLocale } from '@formatjs/intl-localematcher';
import Negotiator from 'negotiator';
import { type NextRequest, NextResponse } from 'next/server';
import { i18n } from './i18.conf';

const locales = i18n.locales;
const LOCALE_COOKIE = 'NEXT_LOCALE';

function getLocale(request: NextRequest): string {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && locales.includes(cookieLocale as typeof locales[number])) {
    return cookieLocale;
  }

  const negotiatorHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    negotiatorHeaders[key] = value;
  });

  const languages = new Negotiator({ headers: negotiatorHeaders }).languages(
    // @ts-expect-error: Readonly array is not assignable to mutable array
    locales,
  );

  return matchLocale(languages, locales, i18n.defaultLocale);
}

export default function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (!pathname.includes('/feed/top')) return NextResponse.next();

  const pathnameIsMissingLocale = locales.every(
    (locale) =>
      !pathname.startsWith(`/${locale}/`) && pathname !== `/${locale}`,
  );

  if (pathnameIsMissingLocale) {
    const locale = getLocale(request);
    return NextResponse.redirect(
      new URL(`/${locale}/${pathname}`, request.url),
    );
  }
}

export const config = {
  matcher: ['/((?!_next).*)', '/'],
};
