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
  const end = Math.min(
    Number(request.headers.range?.split('-')[1]),
    media.length - 1,
  );
  response.writeHead(206, {
    'Content-Range': `bytes 0-${end}/${media.length}`,
    ETag: '"fixture"',
  });
  response.end(media.subarray(0, end + 1));
}

test('reads a coherent tag in one bounded request, pins DNS and sends no credentials', async () => {
  const ranges: string[] = [];
  const headers: IncomingMessage['headers'][] = [];
  handler = (request, response) => {
    ranges.push(request.headers.range ?? '');
    headers.push(request.headers);
    rangeResponse(request, response);
  };
  expect(await read()).toEqual(fixtureTag(4));
  expect(ranges).toEqual([`bytes=0-${MAX_TAG_BYTES - 1}`]);
  expect(headers[0].host).toBe(`fixture.example.invalid:${address.port}`);
  expect(headers[0].cookie).toBeUndefined();
  expect(headers[0].authorization).toBeUndefined();
  expect(headers[0]['if-match']).toBeUndefined();
});

test('assembles a header split across chunks without requesting the tag again', async () => {
  let requests = 0;
  handler = (_, response) => {
    requests++;
    let offset = 0;
    const tag = fixtureTag(4);
    const ends = [1, 3, 6, 10, tag.length];
    const timer = setInterval(() => {
      const end = ends.shift();
      if (end === undefined) {
        clearInterval(timer);
        response.end();
        return;
      }
      response.write(tag.subarray(offset, end));
      offset = end;
    }, 2);
    response.on('close', () => clearInterval(timer));
  };
  expect(await read()).toEqual(fixtureTag(4));
  expect(requests).toBe(1);
});

test('honored and ignored ranges are cancelled after the tag before streaming audio', async () => {
  for (const status of [200, 206]) {
    let requests = 0;
    let audioBytes = 0;
    const closed = Promise.withResolvers<void>();
    handler = (_, response) => {
      requests++;
      response.writeHead(
        status,
        status === 206
          ? { 'Content-Range': `bytes 0-${MAX_TAG_BYTES - 1}/*` }
          : {},
      );
      response.write(fixtureTag(4));
      const timer = setInterval(() => {
        const audio = Buffer.alloc(64 * 1024);
        audioBytes += audio.length;
        response.write(audio);
      }, 50);
      response.on('close', () => {
        clearInterval(timer);
        closed.resolve();
      });
    };
    expect(await read()).toEqual(fixtureTag(4));
    await closed.promise;
    expect(requests).toBe(1);
    expect(audioBytes).toBe(0);
  }
});

test('accepts a shorter 206 range ending at the known resource EOF', async () => {
  const tag = fixtureTag(4);
  handler = (_, response) => {
    response.writeHead(206, {
      'Content-Range': `bytes 0-${tag.length - 1}/${tag.length}`,
      'Content-Length': tag.length,
    });
    response.end(tag);
  };
  expect(await read()).toEqual(tag);
});

test('rejects oversized, misleading, unsafe or incomplete 206 ranges', async () => {
  for (const range of [
    'bytes 1-100/101',
    'bytes 0-9/100',
    'bytes 0-9/*',
    'bytes 0-524288/600000',
    'bytes 0-524287/524287',
    'bytes 0-9007199254740992/9007199254740993',
    'bytes 0-524287/9007199254740993',
    'bytes 0-9/10',
  ]) {
    handler = (_, response) => {
      response.writeHead(206, { 'Content-Range': range });
      response.end(fixtureTag(4));
    };
    await expect(read()).rejects.toThrow();
  }
  handler = (_, response) => {
    response.writeHead(206, {
      'Content-Range': 'bytes 0-524287/600000',
      'Content-Length': fixtureTag(4).length,
    });
    response.end(fixtureTag(4));
  };
  await expect(read()).rejects.toThrow();
  handler = (_, response) => {
    response.writeHead(206, { 'Content-Range': 'bytes 0-8/9' });
    response.end(Buffer.alloc(10));
  };
  await expect(read()).rejects.toThrow();
});

test('reads tags at the memory limit and discards audio sharing the final chunk', async () => {
  const tag = Buffer.concat([
    Buffer.from('ID3\x04\0\0'),
    syncsafe(MAX_TAG_BYTES - 10),
    Buffer.alloc(MAX_TAG_BYTES - 10),
  ]);
  let requests = 0;
  handler = (_, response) => {
    requests++;
    response.end(Buffer.concat([tag, Buffer.alloc(1024)]));
  };
  expect(await read()).toEqual(tag);
  expect(requests).toBe(1);
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

test('rejects a truncated tag after receiving its complete header', async () => {
  handler = (_, response) => {
    response.end(fixtureTag(4).subarray(0, -1));
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
  expect(hosts).toEqual(['fixture.example.invalid', 'cdn.example.invalid']);
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

test('reaches media after five publisher and analytics redirects', async () => {
  const hosts: string[] = [];
  let redirects = 0;
  handler = (request, response) => {
    if (redirects < 5) {
      redirects++;
      response.writeHead(302, {
        Location: `http://hop${redirects}.example.invalid:${address.port}/tag`,
      });
      response.end();
    } else rangeResponse(request, response);
  };
  const result = await readMp3Tag(
    url,
    AbortSignal.timeout(1000),
    async (host) => {
      hosts.push(host);
      return '127.0.0.1';
    },
  );
  expect(result).toMatchObject({ status: 'modified', body: fixtureTag(4) });
  expect(hosts).toContain('hop5.example.invalid');
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

test('absent or oversized metadata requires only one bounded request', async () => {
  const oversized = Buffer.concat([
    Buffer.from('ID3\x04\0\0'),
    syncsafe(MAX_TAG_BYTES),
  ]);
  const unsupported = Buffer.from('ID3\x02\0\0\0\0\0\0');
  const malformed = Buffer.from('ID3\x04\0\0\x80\0\0\0');
  for (const header of [Buffer.alloc(10), oversized, unsupported, malformed]) {
    let requests = 0;
    let remainderSent = false;
    const closed = Promise.withResolvers<void>();
    handler = (_, response) => {
      requests++;
      response.write(header);
      const timer = setTimeout(() => {
        remainderSent = true;
        response.end(Buffer.alloc(MAX_TAG_BYTES));
      }, 50);
      response.on('close', () => {
        clearTimeout(timer);
        closed.resolve();
      });
    };
    expect(await read()).toBeNull();
    await closed.promise;
    expect(requests).toBe(1);
    expect(remainderSent).toBe(false);
  }
});

test('accepts an empty ID3 tag ending at the known resource EOF', async () => {
  const header = Buffer.from('ID3\x04\0\0\0\0\0\0');
  handler = (request, response) => rangeResponse(request, response, header);
  expect(await read()).toEqual(header);
});

test('retains validators and revalidates with a single conditional request', async () => {
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
    expect(requests[0].range).toBe(`bytes=0-${MAX_TAG_BYTES - 1}`);
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
  expect(requests).toHaveLength(1);
  expect(requests[0]['if-none-match']).toBe('"old"');
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

test('uses one response even when the resource changes on the next request', async () => {
  let count = 0;
  handler = (request, response) => {
    if (++count === 1) rangeResponse(request, response);
    else {
      response.writeHead(200, { ETag: '"changed"' });
      response.end(fixtureTag(4));
    }
  };
  expect(await read()).toEqual(fixtureTag(4));
  expect(count).toBe(1);
});
