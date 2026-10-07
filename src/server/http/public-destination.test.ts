import { expect, spyOn, test } from 'bun:test';
import type { ClientRequest } from 'node:http';
import * as https from 'node:https';
import type { DetailedPeerCertificate } from 'node:tls';
import { pinnedRequest } from './public-destination';

test('pinned TLS validates the original hostname, not the destination address', () => {
  let options: https.RequestOptions | undefined;
  const request = spyOn(https, 'request').mockImplementation((_, supplied) => {
    options = supplied as https.RequestOptions;
    return {} as ClientRequest;
  });
  try {
    pinnedRequest(
      new URL('https://publisher.example.invalid/rss'),
      '8.8.8.8',
      AbortSignal.timeout(1000),
      {},
      () => {},
    );
    expect(options?.hostname).toBe('8.8.8.8');
    expect(options?.servername).toBe('publisher.example.invalid');
    const verify = options?.checkServerIdentity;
    if (!verify) throw new Error('Hostname verification missing');
    expect(
      verify('8.8.8.8', {
        subjectaltname: 'DNS:publisher.example.invalid',
      } as DetailedPeerCertificate),
    ).toBeUndefined();
    expect(
      verify('8.8.8.8', {
        subjectaltname: 'IP Address:8.8.8.8',
      } as DetailedPeerCertificate),
    ).toBeInstanceOf(Error);
    expect(options?.rejectUnauthorized).not.toBe(false);
  } finally {
    request.mockRestore();
  }
});
