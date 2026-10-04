import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  isPublicAddress,
  resolvePublicAddress,
} from '@/server/ingest/public-feed-http';
import { id3TagSize, MAX_TAG_BYTES, parseMp3Chapters } from './mp3';

export const METADATA_TIMEOUT_MS = 8000;
export const MAX_REDIRECTS = 4;

type Resolver = (hostname: string) => Promise<string>;

async function pinnedAddress(
  hostname: string,
  signal: AbortSignal,
  resolve: Resolver,
) {
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      resolve(hostname),
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error('Metadata lookup cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

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
  etag?: string;
}

async function requestPrefix(
  input: string,
  bytes: number,
  signal: AbortSignal,
  resolve: Resolver,
  etag?: string,
): Promise<PrefixResponse> {
  const { url, hostname } = enclosureUrl(input);
  const address = await pinnedAddress(hostname, signal, resolve);
  signal.throwIfAborted();
  return new Promise((accept, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const fail = () => reject(new Error('Metadata request failed'));
    const connection = request(
      url,
      {
        hostname: address,
        ...(url.protocol === 'https:'
          ? { servername: isIP(hostname) ? '' : hostname }
          : {}),
        signal,
        agent: false,
        headers: {
          Host: url.host,
          'User-Agent': 'Podcst/1.0',
          'Accept-Encoding': 'identity',
          Range: `bytes=0-${bytes - 1}`,
          ...(etag ? { 'If-Match': etag } : {}),
        },
      },
      (response) => {
        response.on('error', fail);
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          accept({
            body: Buffer.alloc(0),
            location: response.headers.location ?? '',
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
              etag: response.headers.etag,
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
): Promise<Buffer | null> {
  const active = AbortSignal.any([
    signal,
    AbortSignal.timeout(METADATA_TIMEOUT_MS),
  ]);
  let redirects = 0;
  const prefix = async (bytes: number, etag?: string) => {
    if (bytes > MAX_TAG_BYTES) throw new Error('Metadata too large');
    for (;;) {
      const response = await requestPrefix(input, bytes, active, resolve, etag);
      if (response.location === undefined) return response;
      if (!response.location || redirects++ >= MAX_REDIRECTS)
        throw new Error('Metadata redirect limit');
      input = new URL(response.location, input).href;
      enclosureUrl(input);
      etag = undefined;
    }
  };
  const header = await prefix(10);
  const size = id3TagSize(header.body);
  if (size === null) return null;
  if (size === 10) return header.body;
  const tag = await prefix(
    size,
    header.etag?.startsWith('"') ? header.etag : undefined,
  );
  if (
    !tag.body.subarray(0, 10).equals(header.body) ||
    (header.etag && tag.etag && header.etag !== tag.etag)
  )
    throw new Error('Metadata changed during read');
  return tag.body;
}

export async function fetchEmbeddedChapters(input: string) {
  try {
    const buffer = await readMp3Tag(
      input,
      AbortSignal.timeout(METADATA_TIMEOUT_MS),
    );
    return buffer ? await parseMp3Chapters(buffer) : [];
  } catch {
    return [];
  }
}
