import type { LookupAddress, LookupAllOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';

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

export type PublicResolver = (hostname: string) => Promise<string>;

export async function pinnedAddress(
  hostname: string,
  signal: AbortSignal,
  resolve: PublicResolver,
) {
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      resolve(hostname),
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error('Destination lookup timed out'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

export function pinnedRequest(
  url: URL,
  address: string,
  signal: AbortSignal,
  headers: Record<string, string>,
  receive: (response: IncomingMessage) => void,
) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  signal.throwIfAborted();
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return request(
    url,
    {
      hostname: address,
      ...(url.protocol === 'https:'
        ? {
            servername: isIP(hostname) ? '' : hostname,
            checkServerIdentity: (_host, certificate) =>
              checkServerIdentity(hostname, certificate),
          }
        : {}),
      signal,
      agent: false,
      maxHeaderSize: 16 * 1024,
      headers: { ...headers, Host: url.host },
    },
    receive,
  );
}
