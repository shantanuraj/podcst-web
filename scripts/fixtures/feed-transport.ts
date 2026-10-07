import { afterEach, beforeEach, spyOn } from 'bun:test';
import { resolvePublicAddress } from '../../src/server/http/public-destination';
import * as transport from '../../src/server/ingest/feed-request';

const requestFeed = transport.requestFeed;

export function mockFeedTransport() {
  return spyOn(transport, 'requestFeed').mockImplementation((input, options) =>
    requestFeed(input, {
      ...options,
      resolve:
        options.resolve ??
        ((hostname) =>
          hostname === '127.0.0.1'
            ? Promise.resolve('127.0.0.1')
            : resolvePublicAddress(hostname)),
    }),
  );
}

export function installFeedTransportFixture() {
  let mock: ReturnType<typeof mockFeedTransport>;
  beforeEach(() => {
    mock = mockFeedTransport();
  });
  afterEach(() => {
    mock?.mockRestore();
  });
}
