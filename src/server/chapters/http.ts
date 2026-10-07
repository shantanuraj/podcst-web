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
export const MAX_REDIRECTS = 4;

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
  body: Buffer;
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
  bytes: number,
  signal: AbortSignal,
  resolve: Resolver,
  conditions: { revalidate?: HttpValidators; match?: HttpValidators },
): Promise<PrefixResponse> {
  const { url, hostname } = enclosureUrl(input);
  const urlFingerprint = fingerprint(url.href);
  const revalidate =
    conditions.revalidate?.urlFingerprint === urlFingerprint
      ? conditions.revalidate
      : undefined;
  const match =
    conditions.match?.urlFingerprint === urlFingerprint
      ? conditions.match
      : undefined;
  const conditional: Record<string, string> = {};
  if (validEtag(revalidate?.etag))
    conditional['If-None-Match'] = revalidate.etag;
  else if (validLastModified(revalidate?.lastModified))
    conditional['If-Modified-Since'] = revalidate.lastModified;
  if (validEtag(match?.etag) && match.etag.startsWith('"'))
    conditional['If-Match'] = match.etag;
  else if (validLastModified(match?.lastModified))
    conditional['If-Unmodified-Since'] = match.lastModified;
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
        Range: `bytes=0-${bytes - 1}`,
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
        if (
          ![200, 206].includes(status) ||
          (encoding && encoding !== 'identity') ||
          (status === 206 &&
            (!range ||
              Number(range[1]) !== bytes - 1 ||
              (range[2] !== '*' && Number(range[2]) < bytes)))
        ) {
          response.destroy();
          fail();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          const required = chunk.subarray(0, bytes - size);
          chunks.push(Buffer.from(required));
          size += required.length;
          if (size === bytes) {
            accept({
              body: Buffer.concat(chunks, bytes),
              validators,
            });
            response.destroy();
            connection.destroy();
          }
        });
        response.on('end', () => {
          if (size < bytes) fail();
        });
        response.on('close', () => {
          if (size < bytes) fail();
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
  const prefix = async (
    bytes: number,
    conditions: { revalidate?: HttpValidators; match?: HttpValidators },
  ) => {
    if (bytes > MAX_TAG_BYTES) throw new Error('Metadata too large');
    for (;;) {
      const response = await requestPrefix(
        input,
        bytes,
        active,
        resolve,
        conditions,
      );
      if (response.location === undefined) return response;
      if (!response.location || redirects++ >= MAX_REDIRECTS)
        throw new Error('Metadata redirect limit');
      input = new URL(response.location, input).href;
      enclosureUrl(input);
    }
  };
  const header = await prefix(10, { revalidate: validators });
  if (header.notModified)
    return { status: 'not-modified', validators: header.validators };
  let size: number | null;
  try {
    size = id3TagSize(header.body);
  } catch {
    size = null;
  }
  if (size === null || size === 10)
    return {
      status: 'modified',
      body: size === null ? null : header.body,
      validators: header.validators,
    };
  const tag = await prefix(size, { match: header.validators });
  if (
    !tag.body.subarray(0, 10).equals(header.body) ||
    header.validators.urlFingerprint !== tag.validators.urlFingerprint ||
    (header.validators.etag &&
      tag.validators.etag &&
      header.validators.etag !== tag.validators.etag) ||
    (header.validators.lastModified &&
      tag.validators.lastModified &&
      header.validators.lastModified !== tag.validators.lastModified)
  )
    throw new Error('Metadata changed during read');
  return { status: 'modified', body: tag.body, validators: tag.validators };
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
