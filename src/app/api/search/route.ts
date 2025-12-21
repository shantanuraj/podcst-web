/**
 * Podcast Search API
 */
import { type NextRequest, NextResponse } from 'next/server';
import { search } from './search';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const term = params.get('term') || undefined;
  const locale = params.get('locale') || undefined;
  if (!term) {
    return NextResponse.json(
      {
        message: 'parameter `term` cannot be empty',
      },
      { status: 400 },
    );
  }

  const res = await search(term, locale);
  return NextResponse.json(res);
}
