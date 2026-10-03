import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

interface IndexEntry {
  endpoint: string;
  status: number;
  decodesAs: string;
}

interface Capture extends IndexEntry {
  file: string;
  path: string;
  body?: JsonObject;
  trim?: (body: Json) => Json;
}

const origin = process.env.PODCST_API_ORIGIN ?? 'https://www.podcst.app';
const directory = join(import.meta.dir, '..', 'fixtures', 'api');
const indexFile = 'index.json';
const podcastId = 301;
const searchTerm = 'lex fridman';
const locales = ['us', 'nl'];
const listLimit = 3;
const pageLimit = 2;
const notesLimit = 8192;

function object(value: Json): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected a JSON object');
  }
  return value;
}

function array(value: Json): Json[] {
  if (!Array.isArray(value)) throw new TypeError('Expected a JSON array');
  return value;
}

function notes(value: Json): Json {
  if (typeof value !== 'string' || value.length <= notesLimit) return value;
  const end = value.lastIndexOf('</p>', notesLimit);
  return end > 0 ? value.slice(0, end + 4) : value.slice(0, notesLimit);
}

function episode(value: Json): Json {
  const source = object(value);
  return {
    ...source,
    summary: notes(source.summary),
    showNotes: notes(source.showNotes),
  };
}

function episodes(value: Json, limit: number): Json {
  const source = object(value);
  return {
    ...source,
    episodes: array(source.episodes).slice(0, limit).map(episode),
  };
}

function searchResults(value: Json): Json {
  const results = array(value);
  const resolved = results.filter((result) => 'id' in object(result));
  const unresolved = results.filter((result) => !('id' in object(result)));
  const kept = new Set([
    ...resolved.slice(0, listLimit),
    ...unresolved.slice(0, listLimit),
  ]);
  return results.filter((result) => kept.has(result));
}

async function request(capture: Capture): Promise<Json> {
  const response = await fetch(new URL(capture.path, origin), {
    method: capture.endpoint.split(' ')[0],
    headers: {
      Accept: 'application/json',
      ...(capture.body && { 'Content-Type': 'application/json' }),
    },
    body: capture.body && JSON.stringify(capture.body),
  });
  if (response.status !== capture.status) {
    throw new Error(
      `${capture.endpoint} ${capture.path} returned ${response.status}, expected ${capture.status}`,
    );
  }
  const body = (await response.json()) as Json;
  return capture.trim ? capture.trim(body) : body;
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function store(capture: Capture, body: Json) {
  await writeFile(join(directory, capture.file), serialize(body));
  return body;
}

function captures(): Capture[] {
  return [
    ...locales.map(
      (locale): Capture => ({
        file: `top.${locale}.json`,
        endpoint: 'GET /api/top',
        path: `/api/top?locale=${locale}&limit=${listLimit}`,
        status: 200,
        decodesAs: 'TopPodcast[]',
      }),
    ),
    {
      file: 'search.text.json',
      endpoint: 'POST /api/search',
      path: '/api/search',
      body: { term: searchTerm, locale: 'us' },
      status: 200,
      decodesAs: 'SearchResult[]',
      trim: searchResults,
    },
    {
      file: 'search.missing-term.json',
      endpoint: 'POST /api/search',
      path: '/api/search',
      body: {},
      status: 400,
      decodesAs: 'ErrorMessage',
    },
    {
      file: 'feed.id.json',
      endpoint: 'GET /api/feed',
      path: `/api/feed?id=${podcastId}`,
      status: 200,
      decodesAs: 'Podcast',
      trim: (body) => episodes(body, listLimit),
    },
    {
      file: 'feed.not-found.json',
      endpoint: 'GET /api/feed',
      path: '/api/feed?id=999999999999',
      status: 404,
      decodesAs: 'ErrorMessage',
    },
    {
      file: 'feed.invalid-id.json',
      endpoint: 'GET /api/feed',
      path: '/api/feed?id=0',
      status: 400,
      decodesAs: 'ErrorMessage',
    },
    {
      file: 'feed-info.json',
      endpoint: 'GET /api/feed/info',
      path: `/api/feed/info?id=${podcastId}`,
      status: 200,
      decodesAs: 'PodcastInfo',
    },
    {
      file: 'feed-info.missing-id.json',
      endpoint: 'GET /api/feed/info',
      path: '/api/feed/info',
      status: 400,
      decodesAs: 'ErrorMessage',
    },
    {
      file: 'feed-episodes.missing-podcast-id.json',
      endpoint: 'GET /api/feed/episodes',
      path: '/api/feed/episodes',
      status: 400,
      decodesAs: 'ErrorMessage',
    },
    {
      file: 'auth-session.guest.json',
      endpoint: 'GET /api/auth/session',
      path: '/api/auth/session',
      status: 200,
      decodesAs: 'Session',
    },
    {
      file: 'subscriptions.unauthorized.json',
      endpoint: 'GET /api/subscriptions',
      path: '/api/subscriptions',
      status: 401,
      decodesAs: 'ErrorField',
    },
    {
      file: 'progress.unauthorized.json',
      endpoint: 'GET /api/progress',
      path: '/api/progress',
      status: 401,
      decodesAs: 'ErrorField',
    },
  ];
}

function episodePage(file: string, cursor?: number): Capture {
  const query = new URLSearchParams({
    podcastId: String(podcastId),
    limit: String(pageLimit),
    sortBy: 'published',
    sortDir: 'desc',
    ...(cursor !== undefined && { cursor: String(cursor) }),
  });
  return {
    file,
    endpoint: 'GET /api/feed/episodes',
    path: `/api/feed/episodes?${query}`,
    status: 200,
    decodesAs: 'EpisodePage',
    trim: (body) => episodes(body, pageLimit),
  };
}

async function readIndex(): Promise<Record<string, IndexEntry>> {
  const text = await readFile(join(directory, indexFile), 'utf8').catch(
    () => '{}',
  );
  return JSON.parse(text) as Record<string, IndexEntry>;
}

async function verifyIndex(index: Record<string, IndexEntry>) {
  const files = (await readdir(directory)).filter(
    (file) => file.endsWith('.json') && file !== indexFile,
  );
  const missing = files.filter((file) => !(file in index));
  const stale = Object.keys(index).filter((file) => !files.includes(file));
  if (missing.length || stale.length) {
    throw new Error(
      `Fixture index mismatch; unindexed: ${missing.join(', ') || 'none'}; missing files: ${stale.join(', ') || 'none'}`,
    );
  }
}

async function main() {
  const index = await readIndex();
  const record = ({ endpoint, status, decodesAs, file }: Capture) => {
    index[file] = { endpoint, status, decodesAs };
  };
  for (const capture of captures()) {
    await store(capture, await request(capture));
    record(capture);
  }
  const first = episodePage('feed-episodes.first.json');
  const page = object(await store(first, await request(first)));
  record(first);
  if (typeof page.nextCursor !== 'number') {
    throw new Error('First episode page has no nextCursor');
  }
  const second = episodePage('feed-episodes.second.json', page.nextCursor);
  await store(second, await request(second));
  record(second);
  const sorted = Object.fromEntries(
    Object.entries(index).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  await writeFile(join(directory, indexFile), serialize(sorted));
  await verifyIndex(sorted);
}

await main();
