import type { FeedFreshness } from '@/shared/feed-contract';
import { privateFeedHeaders as headers } from '../podcast-access';

export class EpisodeContentError extends Error {
  constructor(
    readonly podcastId: string,
    readonly freshness: FeedFreshness,
  ) {
    super('Episode content unavailable');
  }
  response() {
    const pending = this.freshness.state === 'pending';
    return Response.json(
      {
        code: pending ? 'content_pending' : 'content_unavailable',
        message: pending ? 'Preparing episode' : 'Episode content unavailable',
        freshness: this.freshness,
      },
      { status: pending ? 202 : 503, headers },
    );
  }
}
