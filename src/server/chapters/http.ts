import { isIP } from 'node:net';
import {
  isPublicAddress,
  pinnedAddress,
  pinnedRequest,
  resolvePublicAddress,
} from '@/server/http/public-destination';
import { validEtag, validLastModified } from '@/server/http/validators';
import type { Chapter } from '@/shared/chapters';
import { fingerprint, type HttpValidators } from './cache';
import { id3TagSize, MAX_TAG_BYTES, parseMp3Chapters } from './mp3';

export const METADATA_TIMEOUT_MS = 8000;
export const MAX_REDIRECTS = 10;

type Resolver = (hostname: string) => Promise<string>;

function enclosureUrl(input: string) {
  const url = new URL(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (isIP(hostname) && !isPublicAddress(hostname))
  )
    throw new Error('Unsafe metadata destination');
  return { url, hostname };
}

interface PrefixResponse {
  body: Buffer | null;
  location?: string;
  validators: HttpValidators;
  notModified?: boolean;
}

export type TagResult =
  | {
      status: 'modified';
      body: Buffer | null;
      validators: HttpValidators;
    }
  | { status: 'not-modified'; validators: HttpValidators };

export type ChapterFetchResult =
  | {
      status: 'modified';
      chapters: Chapter[];
      validators: HttpValidators;
    }
  | { status: 'not-modified'; validators: HttpValidators }
  | { status: 'failed' };

async function requestPrefix(
  input: string,
  signal: AbortSignal,
  resolve: Resolver,
  cachedValidators?: HttpValidators,
): Promise<PrefixResponse> {
  const { url, hostname } = enclosureUrl(input);
  const urlFingerprint = fingerprint(url.href);
  const revalidate =
    cachedValidators?.urlFingerprint === urlFingerprint
      ? cachedValidators
      : undefined;
  const conditional: Record<string, string> = {};
  if (validEtag(revalidate?.etag))
    conditional['If-None-Match'] = revalidate.etag;
  else if (validLastModified(revalidate?.lastModified))
    conditional['If-Modified-Since'] = revalidate.lastModified;
  const address = await pinnedAddress(hostname, signal, resolve);
  signal.throwIfAborted();
  return new Promise((accept, reject) => {
    const fail = () => reject(new Error('Metadata request failed'));
    const connection = pinnedRequest(
      url,
      address,
      signal,
      {
        'User-Agent': 'Podcst/1.0',
        'Accept-Encoding': 'identity',
        Range: `bytes=0-${MAX_TAG_BYTES - 1}`,
        ...conditional,
      },
      (response) => {
        response.on('error', fail);
        const status = response.statusCode ?? 0;
        const etag = response.headers.etag;
        const lastModified = response.headers['last-modified'];
        const validators: HttpValidators = {
          urlFingerprint,
          ...(validEtag(etag) ? { etag } : {}),
          ...(validLastModified(lastModified) ? { lastModified } : {}),
        };
        if (status === 304) {
          if (
            (!conditional['If-None-Match'] &&
              !conditional['If-Modified-Since']) ||
            (conditional['If-None-Match'] &&
              validators.etag &&
              validators.etag !== revalidate?.etag) ||
            (conditional['If-Modified-Since'] &&
              validators.lastModified &&
              validators.lastModified !== revalidate?.lastModified)
          )
            fail();
          else
            accept({
              body: Buffer.alloc(0),
              validators: { ...revalidate, ...validators },
              notModified: true,
            });
          response.destroy();
          return;
        }
        if ([301, 302, 303, 307, 308].includes(status)) {
          accept({
            body: Buffer.alloc(0),
            location: response.headers.location ?? '',
            validators,
          });
          response.destroy();
          return;
        }
        const encoding = response.headers['content-encoding'];
        const range = response.headers['content-range']?.match(
          /^bytes 0-(\d+)\/(\d+|\*)$/,
        );
        const rangeEnd = Number(range?.[1]);
        const resourceBytes =
          range?.[2] === '*' ? undefined : Number(range?.[2]);
        const rangeBytes = rangeEnd + 1;
        const contentLength = response.headers['content-length'];
        if (
          ![200, 206].includes(status) ||
          (encoding && encoding !== 'identity') ||
          (status === 206 &&
            (!range ||
              !Number.isSafeInteger(rangeEnd) ||
              rangeBytes < 10 ||
              rangeEnd >= MAX_TAG_BYTES ||
              (resourceBytes !== undefined &&
                (!Number.isSafeInteger(resourceBytes) ||
                  resourceBytes <= rangeEnd)) ||
              // A shorter prefix is valid only when it reaches the resource EOF.
              (rangeBytes < MAX_TAG_BYTES && resourceBytes !== rangeBytes) ||
              (contentLength !== undefined &&
                Number(contentLength) !== rangeBytes)))
        ) {
          response.destroy();
          fail();
          return;
        }
        // Inspect the header before retaining any bytes beyond it.
        let body = Buffer.alloc(10);
        let size = 0;
        let headerRead = false;
        let complete = false;
        const finish = (body: Buffer | null) => {
          complete = true;
          accept({ body, validators });
          response.destroy();
          connection.destroy();
        };
        response.on('data', (chunk: Buffer) => {
          let offset = 0;
          while (!complete && offset < chunk.length) {
            const copied = chunk.copy(body, size, offset);
            size += copied;
            offset += copied;
            if (size !== body.length) return;
            if (!headerRead) {
              headerRead = true;
              let tagBytes: number | null;
              try {
                tagBytes = id3TagSize(body);
              } catch {
                tagBytes = null;
              }
              if (tagBytes === null) {
                finish(null);
                return;
              }
              if (status === 206 && tagBytes > rangeBytes) {
                response.destroy();
                connection.destroy();
                fail();
                return;
              }
              if (tagBytes > body.length) {
                const tag = Buffer.allocUnsafe(tagBytes);
                body.copy(tag);
                body = tag;
              }
            }
            if (size === body.length) finish(body);
          }
        });
        response.on('end', () => {
          if (!complete) fail();
        });
        response.on('close', () => {
          if (!complete) fail();
        });
      },
    );
    connection.on('error', fail);
    connection.end();
  });
}

export async function readMp3Tag(
  input: string,
  signal: AbortSignal,
  resolve: Resolver = resolvePublicAddress,
  validators?: HttpValidators,
): Promise<TagResult> {
  const active = AbortSignal.any([
    signal,
    AbortSignal.timeout(METADATA_TIMEOUT_MS),
  ]);
  let redirects = 0;
  for (;;) {
    const response = await requestPrefix(input, active, resolve, validators);
    if (response.location === undefined) {
      if (response.notModified)
        return { status: 'not-modified', validators: response.validators };
      return {
        status: 'modified',
        body: response.body,
        validators: response.validators,
      };
    }
    if (!response.location || redirects++ >= MAX_REDIRECTS)
      throw new Error('Metadata redirect limit');
    input = new URL(response.location, input).href;
    enclosureUrl(input);
  }
}

export async function fetchChapterMetadata(
  input: string,
  validators?: HttpValidators,
  signal = AbortSignal.timeout(METADATA_TIMEOUT_MS),
): Promise<ChapterFetchResult> {
  try {
    const result = await readMp3Tag(
      input,
      signal,
      resolvePublicAddress,
      validators,
    );
    if (result.status === 'not-modified') return result;
    return {
      status: 'modified',
      chapters: result.body ? await parseMp3Chapters(result.body) : [],
      validators: result.validators,
    };
  } catch {
    return { status: 'failed' };
  }
}
