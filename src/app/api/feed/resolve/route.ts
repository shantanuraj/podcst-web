import { type NextRequest, NextResponse } from 'next/server';
import { DEFAULT_PODCASTS_LOCALE } from '@/data/constants';
import { sql } from '@/server/db';
import { PodcastIdentityConflict } from '@/server/ingest/index-podcast';
import { resolvePodcast } from '@/server/ingest/resolve-podcast';
import { isCanonicalId } from '@/shared/canonical-id';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const itunesId = body?.itunes_id;
  const locale = body?.locale ?? DEFAULT_PODCASTS_LOCALE;
  if (!isCanonicalId(itunesId)) {
    return NextResponse.json(
      { message: 'itunes_id must be a positive integer' },
      { status: 400 },
    );
  }
  if (typeof locale !== 'string' || !/^[a-z]{2}$/i.test(locale)) {
    return NextResponse.json(
      { message: 'locale must be a two-letter country code' },
      { status: 400 },
    );
  }
  try {
    const id = await resolvePodcast(sql, itunesId, locale.toLowerCase());
    return id === null
      ? NextResponse.json({ message: 'Podcast not found' }, { status: 404 })
      : NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      { message: 'Unable to resolve podcast' },
      { status: error instanceof PodcastIdentityConflict ? 409 : 502 },
    );
  }
}
