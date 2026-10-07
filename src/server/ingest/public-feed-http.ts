import { resolvePublicAddress } from '../http/public-destination';
import { publicAliasUrl } from './feed-aliases';
import { MAX_FEED_BYTES } from './feed-limits';
import { requestFeed } from './feed-request';

export interface PublicFeedResponse {
  status: number;
  location?: string;
  body: string;
}

export async function requestPublicFeed(
  input: string,
  signal: AbortSignal,
  resolve = resolvePublicAddress,
  maxBytes = MAX_FEED_BYTES,
): Promise<PublicFeedResponse> {
  return requestFeed(publicAliasUrl(input), { signal, resolve, maxBytes });
}
