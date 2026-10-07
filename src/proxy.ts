import { type NextRequest, NextResponse } from 'next/server';
import { permitsMutation } from './server/auth/request';
import { REGION_COOKIE, requestRegion } from './shared/region';

export default function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith('/api/') && !permitsMutation(request))
    return NextResponse.json(
      { message: 'Request origin refused' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
    );
  if (pathname !== '/' && pathname !== '/feed/top') {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${requestRegion(
    request.cookies.get(REGION_COOKIE)?.value,
    request.headers.get('accept-language'),
  )}/feed/top`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/', '/feed/top', '/api/:path*'],
};
