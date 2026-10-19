import { type NextRequest, NextResponse } from 'next/server';
import { defaultLanguage } from './messages';
import { permitsMutation } from './server/auth/request';
import { isValidLanguage, LANGUAGE_COOKIE } from './shared/i18n/shared';
import { isRegion, REGION_COOKIE, requestRegion } from './shared/region';

export default function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith('/api/') && !permitsMutation(request))
    return NextResponse.json(
      { message: 'Request origin refused' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
    );
  const internal = pathname.match(
    /^\/discover-render\/[^/]+\/([^/]+)\/feed\/top(\/chart)?\/?$/,
  );
  if (internal && isRegion(internal[1])) {
    const url = request.nextUrl.clone();
    url.pathname = `/${internal[1]}/feed/top${internal[2] ?? ''}`;
    return NextResponse.redirect(url, 308);
  }

  const discover = pathname.match(/^\/([^/]+)\/feed\/top(\/chart)?\/?$/);
  if (discover && isRegion(discover[1])) {
    const saved = request.cookies.get(LANGUAGE_COOKIE)?.value;
    const language = saved && isValidLanguage(saved) ? saved : defaultLanguage;
    const url = request.nextUrl.clone();
    url.pathname = `/discover-render/${language}/${discover[1]}/feed/top${discover[2] ?? ''}`;
    return NextResponse.rewrite(url);
  }

  if (pathname !== '/' && pathname !== '/feed/top') return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${requestRegion(
    request.cookies.get(REGION_COOKIE)?.value,
    request.headers.get('accept-language'),
  )}/feed/top`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/',
    '/feed/top',
    '/:locale/feed/top/:path*',
    '/discover-render/:path*',
    '/api/:path*',
  ],
};
