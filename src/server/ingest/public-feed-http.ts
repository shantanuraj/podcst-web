import type { LookupAddress, LookupAllOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { publicAliasUrl } from './feed-aliases';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6');
const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');
const MAX_BYTES = 32 * 1024 * 1024;

export function isPublicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, 'ipv4')
    : family === 6 &&
        globalIPv6.check(address, 'ipv6') &&
        !blocked.check(address, 'ipv6');
}

export async function resolvePublicAddress(
  hostname: string,
  resolve: (
    hostname: string,
    options: LookupAllOptions,
  ) => Promise<LookupAddress[]> = lookup,
) {
  const addresses = await resolve(hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  )
    throw new Error('Nonpublic feed destination');
  return addresses[0].address;
}

export interface PublicFeedResponse {
  status: number;
  location?: string;
  body: string;
}

export async function requestPublicFeed(
  input: string,
  signal: AbortSignal,
  resolve = resolvePublicAddress,
  maxBytes = MAX_BYTES,
): Promise<PublicFeedResponse> {
  const url = new URL(publicAliasUrl(input));
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  let address: string;
  try {
    address = await Promise.race([
      resolve(hostname),
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error('Feed lookup timed out'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
  signal.throwIfAborted();
  return new Promise((accept, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const connection = request(
      url,
      {
        hostname: address,
        ...(url.protocol === 'https:'
          ? { servername: isIP(hostname) ? '' : hostname }
          : {}),
        signal,
        headers: {
          Host: url.host,
          'User-Agent': 'Podcst/1.0',
          'Accept-Encoding': 'gzip, br, deflate',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          accept({ status, location: response.headers.location, body: '' });
          response.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes)
            response.destroy(new Error('Feed response too large'));
          else chunks.push(chunk);
        });
        response.on('error', () =>
          reject(new Error('Feed response failed or exceeded limits')),
        );
        response.on('end', () => {
          try {
            const compressed = Buffer.concat(chunks);
            const encoding = response.headers['content-encoding'];
            const options = { maxOutputLength: maxBytes };
            let body: Buffer;
            if (!encoding || encoding === 'identity') body = compressed;
            else if (encoding === 'gzip')
              body = gunzipSync(compressed, options);
            else if (encoding === 'br')
              body = brotliDecompressSync(compressed, options);
            else if (encoding === 'deflate')
              body = inflateSync(compressed, options);
            else throw new Error('Unsupported encoding');
            accept({ status, body: body.toString('utf8') });
          } catch {
            reject(new Error('Invalid or oversized feed encoding'));
          }
        });
      },
    );
    connection.on('error', () =>
      reject(new Error('Public feed request failed')),
    );
    connection.end();
  });
}
