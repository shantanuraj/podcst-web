import { type NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PODCASTS_LOCALE } from '@/data/constants';
import { noteworthy } from '@/server/discover';

const LIMIT = 14;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const category = params.get('category');
  const id = category === null ? null : Number(category);
  if (id !== null && !Number.isSafeInteger(id))
    return NextResponse.json(
      { message: 'parameter `category` must be an integer' },
      { status: 400 },
    );
  return NextResponse.json(
    await noteworthy(
      params.get('locale') || DEFAULT_PODCASTS_LOCALE,
      LIMIT,
      id,
    ),
  );
}
