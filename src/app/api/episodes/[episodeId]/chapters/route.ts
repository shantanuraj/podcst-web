import { getSession } from '@/server/auth/session';
import { readChapterEpisode } from '@/server/chapters/episode';
import { chapterResponse } from '@/server/chapters/response';
import { createChapterService } from '@/server/chapters/service';
import { sql } from '@/server/db';

export const runtime = 'nodejs';

const chapters = createChapterService((id, userId) =>
  readChapterEpisode(sql, id, userId),
);

export async function GET(
  _request: Request,
  context: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await context.params;
  const session = await getSession();
  return chapterResponse(episodeId, session?.userId ?? null, chapters);
}
