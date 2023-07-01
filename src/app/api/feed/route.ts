import { NextRequest, NextResponse } from 'next/server';
import { feed } from './feed';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const url = params.get('url');
  if (!url) {
    return NextResponse.json(
      {
        message: 'parameter `url` cannot be empty',
      },
      { status: 400 },
    );
  }

  const safeUrl = decodeURIComponent(url);
  try {
    // Check if url is valid
    new URL(safeUrl);
  } catch (err) {
    return NextResponse.json(
      {
        message: 'parameter `url` cannot be parsed',
        url,
        safeUrl,
      },
      { status: 400 },
    );
  }
  const res = await feed(safeUrl);

  return NextResponse.json(res.entity);
}
