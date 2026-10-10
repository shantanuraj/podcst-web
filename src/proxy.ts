import { type NextRequest, NextResponse } from 'next/server';
import { permitsMutation } from './server/auth/request';
import {
  ADMISSION_CHALLENGE,
  ADMISSION_RESPONSE,
  requireRuntimeAdmission,
} from './server/erasure/admission';
import { REGION_COOKIE, requestRegion } from './shared/region';

export default async function proxy(request: NextRequest) {
  let admission: Awaited<ReturnType<typeof requireRuntimeAdmission>>;
  try {
    admission = await requireRuntimeAdmission(
      undefined,
      request.headers.get(ADMISSION_CHALLENGE) ?? undefined,
    );
  } catch {
    return NextResponse.json(
      { message: 'Service unavailable' },
      {
        status: 503,
        headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '5' },
      },
    );
  }
  const admitted = (response: NextResponse) => {
    if (admission && request.headers.has(ADMISSION_CHALLENGE))
      response.headers.set(
        ADMISSION_RESPONSE,
        Buffer.from(JSON.stringify(admission.response)).toString('base64url'),
      );
    return response;
  };
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith('/api/') && !permitsMutation(request))
    return admitted(
      NextResponse.json(
        { message: 'Request origin refused' },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
      ),
    );
  if (pathname !== '/' && pathname !== '/feed/top') {
    return admitted(NextResponse.next());
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${requestRegion(
    request.cookies.get(REGION_COOKIE)?.value,
    request.headers.get('accept-language'),
  )}/feed/top`;
  return admitted(NextResponse.redirect(url));
}

export const config = {
  matcher: ['/:path*'],
};
