#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DomUtils, parseDocument } from 'htmlparser2';
import { parseFile } from 'music-metadata';

const defaults = {
  baseUrl: 'https://www.podcst.app',
  maxBytes: 512 * 1024 * 1024,
  timeoutMs: 120_000,
};

const usage = `Usage: bun scripts/inspect-mp3.ts [options] <input>

Input: podcast_id/episode_id, Podcst episode URL, HTTP(S) MP3 URL,
       or local MP3 path (including file:// URLs).

Options:
  --base-url URL    Podcst origin for episode IDs (default: ${defaults.baseUrl})
  --max-bytes N     Maximum remote MP3 download (default: ${defaults.maxBytes})
  --timeout N       Network deadline in milliseconds (default: ${defaults.timeoutMs})
  --binary         Include binary tag data as base64
  -h, --help       Show this help

Outputs JSON with source details, redirects, leading ID3 header, audio format,
common tags, all decoded native tags (including chapter subframes), and warnings.
Remote MP3s are downloaded in full to a temporary file, then deleted.
Binary data is summarized by byte length and SHA-256 unless --binary is set.`;

export interface InspectOptions {
  baseUrl?: string;
  maxBytes?: number;
  timeoutMs?: number;
}

function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive safe integer`);
  return value;
}

function httpUrl(input: string) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Only HTTP(S) media and episode URLs are supported');
  if (url.username || url.password)
    throw new Error('URLs with embedded credentials are not supported');
  return url;
}

async function request(input: string, signal: AbortSignal) {
  let url = httpUrl(input);
  const redirects: { url: string; status: number; location: string }[] = [];
  for (;;) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': 'Podcst/1.0',
        'Accept-Encoding': 'identity',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect without Location: ${url}`);
      if (redirects.length >= 10) throw new Error('Exceeded 10 HTTP redirects');
      const next = httpUrl(new URL(location, url).href);
      redirects.push({
        url: url.href,
        status: response.status,
        location: next.href,
      });
      url = next;
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}: ${url}`);
    }
    return {
      response,
      http: {
        url: input,
        finalUrl: url.href,
        redirects,
        headers: Object.fromEntries(response.headers),
      },
    };
  }
}

async function* responseBytes(response: Response, maxBytes: number) {
  if (!response.body) throw new Error('HTTP response has no body');
  const reader = response.body.getReader();
  const encoding = response.headers.get('content-encoding');
  const length = response.headers.get('content-length');
  const expected =
    length !== null && (!encoding || encoding === 'identity')
      ? Number(length)
      : null;
  let bytes = 0;
  try {
    if (expected !== null && expected > maxBytes)
      throw new Error(`Response exceeds ${maxBytes} bytes`);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes)
        throw new Error(`Response exceeds ${maxBytes} bytes`);
      yield value;
    }
    if (expected !== null && bytes !== expected)
      throw new Error(`Truncated response: expected ${expected}, got ${bytes}`);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function resolveEpisode(url: string, signal: AbortSignal) {
  const { response, http } = await request(url, signal);
  const chunks: Uint8Array[] = [];
  for await (const chunk of responseBytes(response, 2 * 1024 * 1024))
    chunks.push(chunk);
  const document = parseDocument(Buffer.concat(chunks).toString('utf8'));
  for (const script of DomUtils.getElementsByTagName('script', document)) {
    if (script.attribs.type !== 'application/ld+json') continue;
    let schema: unknown;
    try {
      schema = JSON.parse(DomUtils.textContent(script));
    } catch {
      continue;
    }
    if (
      schema &&
      typeof schema === 'object' &&
      '@type' in schema &&
      schema['@type'] === 'PodcastEpisode' &&
      'associatedMedia' in schema
    ) {
      const media = schema.associatedMedia;
      if (
        media &&
        typeof media === 'object' &&
        'contentUrl' in media &&
        typeof media.contentUrl === 'string'
      )
        return {
          url: httpUrl(new URL(media.contentUrl, http.finalUrl).href).href,
          episode: {
            ...http,
            title: 'name' in schema ? schema.name : undefined,
          },
        };
    }
  }
  throw new Error('No public PodcastEpisode enclosure found on the page');
}

async function leadingId3(path: string) {
  const header = Buffer.from(await Bun.file(path).slice(0, 10).arrayBuffer());
  if (header.toString('ascii', 0, 3) !== 'ID3') return null;
  if (header.length < 10) throw new Error('Truncated ID3 header');
  if (header.subarray(6).some((byte) => byte & 0x80))
    throw new Error('Invalid ID3 syncsafe size');
  const bodyBytes = header
    .subarray(6)
    .reduce((size, byte) => size * 128 + byte, 0);
  const footerBytes = header[3] === 4 && header[5] & 0x10 ? 10 : 0;
  return {
    version: `2.${header[3]}.${header[4]}`,
    flags: `0x${header[5].toString(16).padStart(2, '0')}`,
    bodyBytes,
    footerBytes,
    totalBytes: 10 + bodyBytes + footerBytes,
  };
}

export function serializeTags(value: unknown, binary = false): unknown {
  if (value instanceof Uint8Array)
    return {
      byteLength: value.byteLength,
      sha256: createHash('sha256').update(value).digest('hex'),
      ...(binary ? { base64: Buffer.from(value).toString('base64') } : {}),
    };
  if (value instanceof Map)
    return Object.fromEntries(
      [...value].map(([key, item]) => [key, serializeTags(item, binary)]),
    );
  if (Array.isArray(value))
    return value.map((item) => serializeTags(item, binary));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (
      'format' in value &&
      value.format === '-->' &&
      'data' in value &&
      value.data instanceof Uint8Array
    )
      entries.push([
        'url',
        Buffer.from(value.data).toString('latin1').split('\0', 1)[0],
      ]);
    return Object.fromEntries(
      entries.map(([key, item]) => [key, serializeTags(item, binary)]),
    );
  }
  return value;
}

export async function inspectMp3(input: string, options: InspectOptions = {}) {
  const settings = { ...defaults, ...options };
  positiveInteger(settings.maxBytes, 'maxBytes');
  positiveInteger(settings.timeoutMs, 'timeoutMs');
  const base = httpUrl(settings.baseUrl);
  const pair = /^[1-9]\d*\/[1-9]\d*$/.test(input);
  const remote = /^https?:\/\//i.test(input);
  const url = pair
    ? new URL(`/episodes/${input}`, base)
    : remote
      ? httpUrl(input)
      : null;
  const page =
    url &&
    (pair ||
      ([base.origin, 'https://podcst.app', 'https://www.podcst.app'].includes(
        url.origin,
      ) &&
        /^\/episodes\/[1-9]\d*\/[1-9]\d*\/?$/.test(url.pathname)));
  const signal = AbortSignal.timeout(settings.timeoutMs);
  const resolved = page && url ? await resolveEpisode(url.href, signal) : null;
  let directory: string | undefined;
  try {
    let path: string;
    let http: Awaited<ReturnType<typeof request>>['http'] | undefined;
    if (url) {
      directory = await mkdtemp(join(tmpdir(), 'podcst-inspect-mp3-'));
      path = join(directory, 'audio.mp3');
      const result = await request(resolved?.url ?? url.href, signal);
      http = result.http;
      await pipeline(
        Readable.from(responseBytes(result.response, settings.maxBytes)),
        createWriteStream(path, { mode: 0o600 }),
        { signal },
      );
    } else
      path = input.startsWith('file:') ? fileURLToPath(input) : resolve(input);
    const file = await stat(path);
    if (!file.isFile()) throw new Error('Input must be a regular file');
    const id3v2 = await leadingId3(path);
    if (id3v2 && id3v2.totalBytes > file.size)
      throw new Error('ID3 tag extends beyond the end of the file');
    const metadata = await parseFile(path, {
      duration: true,
      skipCovers: false,
      skipPostHeaders: false,
      includeChapters: true,
    });
    return {
      source: {
        input,
        episode: resolved?.episode,
        http,
        path: http ? undefined : path,
        bytes: file.size,
      },
      leadingId3v2: id3v2,
      ...metadata,
    };
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export async function main(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      binary: { type: 'boolean', default: false },
      'base-url': { type: 'string', default: defaults.baseUrl },
      'max-bytes': { type: 'string', default: String(defaults.maxBytes) },
      timeout: { type: 'string', default: String(defaults.timeoutMs) },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (positionals.length !== 1) throw new Error(usage);
  const report = await inspectMp3(positionals[0], {
    baseUrl: values['base-url'],
    maxBytes: Number(values['max-bytes']),
    timeoutMs: Number(values.timeout),
  });
  console.log(JSON.stringify(serializeTags(report, values.binary), null, 2));
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
