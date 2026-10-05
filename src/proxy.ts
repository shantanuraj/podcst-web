import { type NextRequest, NextResponse } from 'next/server';
import { i18n } from './i18.conf';
import { isRegion, REGION_COOKIE, regionFromLanguages } from './shared/region';

function getLocale(request: NextRequest): string {
  const saved = request.cookies.get(REGION_COOKIE)?.value;
  if (isRegion(saved)) return saved;
  const languages = (request.headers.get('accept-language') ?? '')
    .split(',')
    .map((part) => part.split(';')[0].trim())
    .filter(Boolean);
  return regionFromLanguages(languages) ?? i18n.defaultLocale;
}

export default function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname !== '/' && pathname !== '/feed/top') {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${getLocale(request)}/feed/top`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/', '/feed/top'],
};
