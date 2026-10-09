import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import {
  NonpublicDestination,
  type PublicResolver,
  pinnedAddress,
  pinnedRequest,
  resolvePublicAddress,
} from '../http/public-destination';
import { validEtag, validLastModified } from '../http/validators';

import { FeedUnavailableError } from './feed-errors';
import { MAX_FEED_BYTES } from './feed-limits';

export interface FeedValidators {
  etag?: string | null;
  lastModified?: string | null;
}

export interface FeedResponse {
  status: number;
  location?: string;
  body: string;
  etag: string | null;
  lastModified: string | null;
}

export function feedDestination(input: string) {
  try {
    const url = new URL(input);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error();
    return url;
  } catch {
    throw new FeedUnavailableError('Invalid feed protocol or destination');
  }
}

export function feedConditions(validators: FeedValidators) {
  const headers: Record<string, string> = {};
  if (validEtag(validators.etag)) headers['If-None-Match'] = validators.etag;
  if (validLastModified(validators.lastModified))
    headers['If-Modified-Since'] = validators.lastModified;
  return headers;
}

export async function requestFeed(
  input: string,
  {
    signal,
    resolve = resolvePublicAddress,
    maxBytes = MAX_FEED_BYTES,
    validators = {},
  }: {
    signal: AbortSignal;
    resolve?: PublicResolver;
    maxBytes?: number;
    validators?: FeedValidators;
  },
): Promise<FeedResponse> {
  const url = feedDestination(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let address: string;
  try {
    address = await pinnedAddress(hostname, signal, resolve);
  } catch (error) {
    if (error instanceof NonpublicDestination)
      throw new FeedUnavailableError('Nonpublic feed destination');
    throw new Error('Feed destination lookup failed or timed out');
  }
  signal.throwIfAborted();
  return new Promise((accept, reject) => {
    const fail = () =>
      reject(new Error('Feed response failed or exceeded limits'));
    const connection = pinnedRequest(
      url,
      address,
      signal,
      {
        'User-Agent': 'Podcst/1.0',
        'Accept-Encoding': 'gzip, br, deflate',
        ...feedConditions(validators),
      },
      (response) => {
        response.on('error', fail);
        const status = response.statusCode ?? 0;
        const meta = {
          status,
          etag: validEtag(response.headers.etag) ? response.headers.etag : null,
          lastModified: validLastModified(response.headers['last-modified'])
            ? response.headers['last-modified']
            : null,
        };
        if (status >= 300 && status < 400) {
          accept({ ...meta, location: response.headers.location, body: '' });
          response.destroy();
          return;
        }
        if (status !== 200) {
          accept({ ...meta, body: '' });
          response.destroy();
          return;
        }
        const length = response.headers['content-length'];
        if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
          reject(new FeedUnavailableError('Feed response too large'));
          response.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            reject(new FeedUnavailableError('Feed response too large'));
            response.destroy();
          } else chunks.push(chunk);
        });
        response.on('close', () => {
          if (!response.complete) fail();
        });
        response.on('end', () => {
          try {
            if (
              !response.complete ||
              signal.aborted ||
              (length && Number(length) !== size)
            )
              throw new Error();
            const compressed = Buffer.concat(chunks);
            const encoding =
              response.headers['content-encoding']?.toLowerCase();
            const options = { maxOutputLength: maxBytes };
            let body: Buffer;
            if (!encoding || encoding === 'identity') body = compressed;
            else if (encoding === 'gzip')
              body = gunzipSync(compressed, options);
            else if (encoding === 'br')
              body = brotliDecompressSync(compressed, options);
            else if (encoding === 'deflate')
              body = inflateSync(compressed, options);
            else throw new Error();
            accept({ ...meta, body: body.toString('utf8') });
          } catch {
            reject(
              new FeedUnavailableError('Invalid or oversized feed encoding'),
            );
          }
        });
      },
    );
    connection.on('error', fail);
    connection.end();
  });
}
