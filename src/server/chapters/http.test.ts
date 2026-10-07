import { afterAll, expect, test } from 'bun:test';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  isPublicAddress,
  resolvePublicAddress,
} from '@/server/http/public-destination';
import {
  fixtureMp3,
  fixtureTag,
  syncsafe,
} from '../../../scripts/fixtures/mp3-chapters';
import { fingerprint } from './cache';
import { fetchChapterMetadata, MAX_REDIRECTS, readMp3Tag } from './http';
import { MAX_TAG_BYTES } from './mp3';

let handler: (request: IncomingMessage, response: ServerResponse) => void;
const server = createServer((request, response) => handler(request, response));
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No fixture port');
const url = `http://fixture.example.invalid:${address.port}/audio`;
const resolveFixture = async () => '127.0.0.1';
const read = async (signal = AbortSignal.timeout(1000)) => {
  const result = await readMp3Tag(url, signal, resolveFixture);
  return result.status === 'modified' ? result.body : null;
};
afterAll(() => server.close());

function rangeResponse(
  request: IncomingMessage,
  response: ServerResponse,
  media = fixtureMp3(4),
) {
  const end = Number(request.headers.range?.split('-')[1]);
  response.writeHead(206, {
    'Content-Range': `bytes 0-${end}/${media.length}`,
    ETag: '"fixture"',
  });
  response.end(media.subarray(0, end + 1));
}

test('requests only header and tag ranges, pins DNS and sends no cookies', async () => {
  const ranges: string[] = [];
  const headers: IncomingMessage['headers'][] = [];
  handler = (request, response) => {
    ranges.push(request.headers.range ?? '');
    headers.push(request.headers);
    rangeResponse(request, response);
  };
  expect(await read()).toEqual(fixtureTag(4));
  expect(ranges).toEqual(['bytes=0-9', `bytes=0-${fixtureTag(4).length - 1}`]);
  expect(headers[0].host).toBe(`fixture.example.invalid:${address.port}`);
  expect(headers[0].cookie).toBeUndefined();
  expect(headers[0].authorization).toBeUndefined();
  expect(headers[1]['if-match']).toBe('"fixture"');
});

test('ignored ranges are cancelled at the required prefix without consuming audio', async () => {
  let sent = 0;
  let closed = 0;
  handler = (_, response) => {
    let offset = 0;
    const bytes = fixtureMp3(4);
    const timer = setInterval(() => {
      const chunk = bytes.subarray(offset, offset + 64);
      offset += chunk.length;
      sent += chunk.length;
      response.write(chunk);
    }, 2);
    response.on('close', () => {
      clearInterval(timer);
      closed++;
    });
  };
  expect(await read()).toEqual(fixtureTag(4));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(closed).toBe(2);
  expect(sent).toBeLessThan(fixtureTag(4).length + 256);
});

test('truncation, invalid ranges, encodings and upstream failures fall back', async () => {
  for (const variant of ['short', 'range', 'encoding', 'error']) {
    handler = (_, response) => {
      response.writeHead(
        variant === 'error' ? 500 : variant === 'range' ? 206 : 200,
        {
          ...(variant === 'range' ? { 'Content-Range': 'bytes 1-10/100' } : {}),
          ...(variant === 'encoding' ? { 'Content-Encoding': 'gzip' } : {}),
        },
      );
      response.end(
        variant === 'short' ? fixtureTag(4).subarray(0, 9) : fixtureTag(4),
      );
    };
    await expect(read()).rejects.toThrow();
  }
});

test('rejects a truncated tag after a successful header probe', async () => {
  handler = (request, response) => {
    if (request.headers.range === 'bytes=0-9') rangeResponse(request, response);
    else response.end(fixtureTag(4).subarray(0, -1));
  };
  await expect(read()).rejects.toThrow();
});

test('bounds slow headers, slow bodies, DNS resolution and explicit cancellation', async () => {
  handler = () => {};
  await expect(read(AbortSignal.timeout(20))).rejects.toThrow();
  handler = (_, response) => {
    response.writeHead(200);
    response.write('ID3');
  };
  await expect(read(AbortSignal.timeout(20))).rejects.toThrow();
  await expect(
    readMp3Tag(url, AbortSignal.timeout(20), () => new Promise(() => {})),
  ).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(read(controller.signal)).rejects.toThrow();
});

test('validates every redirect, resolves new hosts, and bounds loops', async () => {
  const hosts: string[] = [];
  handler = (request, response) => {
    if (request.url === '/audio') {
      response.writeHead(302, {
        Location: `http://cdn.example.invalid:${address.port}/tag`,
      });
      response.end();
    } else rangeResponse(request, response);
  };
  expect(
    await readMp3Tag(url, AbortSignal.timeout(1000), async (host) => {
      hosts.push(host);
      return '127.0.0.1';
    }),
  ).toMatchObject({ status: 'modified', body: fixtureTag(4) });
  expect(hosts).toEqual([
    'fixture.example.invalid',
    'cdn.example.invalid',
    'cdn.example.invalid',
  ]);
  for (const target of [
    'http://127.0.0.1/private',
    'http://169.254.169.254/credentials',
    'file:///tmp/secret',
    'https://user:secret@example.com/audio',
  ]) {
    handler = (_, response) => {
      response.writeHead(302, { Location: target });
      response.end();
    };
    await expect(read()).rejects.toThrow();
  }
  let count = 0;
  handler = (_, response) => {
    count++;
    response.writeHead(302, { Location: url });
    response.end();
  };
  await expect(read()).rejects.toThrow();
  expect(count).toBe(MAX_REDIRECTS + 1);
});

test('rejects private DNS, literals, mixed answers and unsupported schemes', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fc00::1',
    '2002:7f00:1::',
  ])
    expect(isPublicAddress(ip)).toBe(false);
  expect(isPublicAddress('8.8.8.8')).toBe(true);
  expect(isPublicAddress('2001:4860:4860::8888')).toBe(true);
  await expect(resolvePublicAddress('localhost')).rejects.toThrow();
  await expect(
    resolvePublicAddress('mixed.example.invalid', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
  ).rejects.toThrow();
  for (const target of [
    'http://2130706433/audio',
    'http://[::1]/audio',
    'ftp://example.com/audio',
  ])
    await expect(
      readMp3Tag(target, AbortSignal.timeout(1000)),
    ).rejects.toThrow();
});

test('revalidates named DNS destinations at redirects before connecting', async () => {
  let requests = 0;
  handler = (_, response) => {
    requests++;
    response.writeHead(302, {
      Location: `http://localhost:${address.port}/private`,
    });
    response.end();
  };
  await expect(
    readMp3Tag(url, AbortSignal.timeout(1000), (host) =>
      host === 'fixture.example.invalid'
        ? resolveFixture()
        : resolvePublicAddress(host),
    ),
  ).rejects.toThrow();
  expect(requests).toBe(1);
});

test('absent or oversized metadata requires only one header request', async () => {
  let count = 0;
  handler = (_, response) => {
    count++;
    response.end(Buffer.alloc(10));
  };
  expect(await read()).toBeNull();
  expect(count).toBe(1);
  handler = (_, response) => {
    count++;
    response.end(
      Buffer.concat([Buffer.from('ID3\x04\0\0'), syncsafe(MAX_TAG_BYTES)]),
    );
  };
  expect(await read()).toBeNull();
  expect(count).toBe(2);
});

test('retains validators and revalidates with a single conditional header request', async () => {
  const modified = 'Wed, 01 Oct 2025 00:00:00 GMT';
  for (const etag of ['"fixture"', 'W/"fixture"', undefined]) {
    const requests: IncomingMessage['headers'][] = [];
    handler = (request, response) => {
      requests.push(request.headers);
      response.writeHead(304);
      response.end();
    };
    const validators = {
      urlFingerprint: fingerprint(url),
      etag,
      lastModified: modified,
    };
    expect(
      await readMp3Tag(
        url,
        AbortSignal.timeout(1000),
        resolveFixture,
        validators,
      ),
    ).toEqual({ status: 'not-modified', validators });
    expect(requests).toHaveLength(1);
    expect(requests[0].range).toBe('bytes=0-9');
    expect(requests[0]['if-none-match']).toBe(etag);
    expect(requests[0]['if-modified-since']).toBe(etag ? undefined : modified);
  }
  handler = (request, response) => {
    response.setHeader('Last-Modified', modified);
    rangeResponse(request, response);
  };
  expect(
    await readMp3Tag(url, AbortSignal.timeout(1000), resolveFixture),
  ).toMatchObject({
    status: 'modified',
    validators: {
      urlFingerprint: fingerprint(url),
      etag: '"fixture"',
      lastModified: modified,
    },
  });
});

test('changed or ignored conditional responses read bounded metadata again', async () => {
  const requests: IncomingMessage['headers'][] = [];
  handler = (request, response) => {
    requests.push(request.headers);
    rangeResponse(request, response);
  };
  const result = await readMp3Tag(
    url,
    AbortSignal.timeout(1000),
    resolveFixture,
    { urlFingerprint: fingerprint(url), etag: '"old"' },
  );
  expect(result).toMatchObject({
    status: 'modified',
    body: fixtureTag(4),
    validators: { etag: '"fixture"' },
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]['if-none-match']).toBe('"old"');
  expect(requests[1]['if-none-match']).toBeUndefined();
  expect(requests[1]['if-match']).toBe('"fixture"');
});

test('binds validators to exact redirect targets and does not forward them to different media', async () => {
  const target = `http://cdn.example.invalid:${address.port}/media?secret=original`;
  const requests: IncomingMessage['headers'][] = [];
  handler = (request, response) => {
    requests.push(request.headers);
    if (request.url === '/audio') {
      response.writeHead(302, { Location: target });
      response.end();
    } else {
      response.writeHead(304);
      response.end();
    }
  };
  const validators = {
    urlFingerprint: fingerprint(target),
    etag: '"same-cdn-media"',
  };
  expect(
    await readMp3Tag(
      url,
      AbortSignal.timeout(1000),
      resolveFixture,
      validators,
    ),
  ).toEqual({ status: 'not-modified', validators });
  expect(requests[0]['if-none-match']).toBeUndefined();
  expect(requests[1]['if-none-match']).toBe('"same-cdn-media"');
  handler = (request, response) => {
    if (request.url === '/audio') {
      response.writeHead(302, {
        Location: target.replace('original', 'replaced'),
      });
      response.end();
    } else {
      expect(request.headers['if-none-match']).toBeUndefined();
      rangeResponse(request, response);
    }
  };
  expect(
    (
      await readMp3Tag(
        url,
        AbortSignal.timeout(1000),
        resolveFixture,
        validators,
      )
    ).status,
  ).toBe('modified');
});

test('rejects unsolicited or contradictory 304 responses and sanitizes validators', async () => {
  handler = (_, response) => {
    response.writeHead(304);
    response.end();
  };
  await expect(
    readMp3Tag(url, AbortSignal.timeout(1000), resolveFixture),
  ).rejects.toThrow();
  await expect(
    readMp3Tag(url, AbortSignal.timeout(1000), resolveFixture, {
      urlFingerprint: fingerprint(url),
      etag: 'invalid\r\nHeader',
    }),
  ).rejects.toThrow();
  handler = (_, response) => {
    response.writeHead(304, { ETag: '"changed"' });
    response.end();
  };
  await expect(
    readMp3Tag(url, AbortSignal.timeout(1000), resolveFixture, {
      urlFingerprint: fingerprint(url),
      etag: '"old"',
    }),
  ).rejects.toThrow();
  handler = (request, response) => {
    response.setHeader('Last-Modified', 'invalid date');
    rangeResponse(request, response);
  };
  const result = await readMp3Tag(
    url,
    AbortSignal.timeout(1000),
    resolveFixture,
  );
  expect(result.validators.lastModified).toBeUndefined();
});

test('conditional refreshes retain SSRF protection and report failure without a URL', async () => {
  handler = (_, response) => {
    response.writeHead(302, { Location: 'http://169.254.169.254/private' });
    response.end();
  };
  await expect(
    readMp3Tag(url, AbortSignal.timeout(1000), resolveFixture, {
      urlFingerprint: fingerprint(url),
      etag: '"old"',
    }),
  ).rejects.toThrow();
  expect(await fetchChapterMetadata('http://127.0.0.1/secret')).toEqual({
    status: 'failed',
  });
});

test('rejects representations changing between ranges', async () => {
  let count = 0;
  handler = (request, response) => {
    if (++count === 1) rangeResponse(request, response);
    else {
      response.writeHead(200, { ETag: '"changed"' });
      response.end(fixtureTag(4));
    }
  };
  await expect(read()).rejects.toThrow();
});
