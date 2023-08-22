/**
 * Helpers
 */

import { Parser } from 'xml2js';

import { reformatShowNotes, showNotesSorter } from './format';
import { IEpisode, IEpisodeListing } from '@/types';

/**
 * Read itunes file prop
 */
const readFile = (file: any) => ({
  ...file,
  length: parseInt(file.length, 10),
});

/**
 * Read data from json
 */
const readDate = (ctx: any): number | null => {
  const data = ctx.pubDate || ctx.lastBuildDate;
  return data ? +new Date(data[0]) : null;
};

/**
 * Read summary from json
 */
const readSummary = (ctx: any): string | null => {
  const data = ctx['itunes:summary'] || ctx['itunes:subtitle'];
  if (Array.isArray(data)) {
    return (data[0]['_'] || data[0]).trim();
  }

  return null;
};

/**
 * Read description from json
 */
const readDescription = (ctx: any): string => {
  return (
    (Array.isArray(ctx.description) && (ctx.description[0] || '').trim()) || readSummary(ctx) || ''
  );
};

/**
 * Map of index position to number of miliseconds
 */
const indexToSecondsMap = {
  0: 1,
  1: 60,
  2: 60 * 60,
};

/**
 * Read duration from json
 */
const readDuration = (ctx: any): number | null => {
  const _data = ctx['itunes:duration'];
  if (!_data) {
    return null;
  }
  const data = _data[0]['_'] || _data[0];
  if (data.indexOf(':') === -1) {
    return parseInt(data, 10);
  }
  const vals = data
    .split(':')
    .map((e: string) => parseInt(e, 10))
    .reverse();
  return vals.reduce(
    (acc: number, val: number, i: number) =>
      acc + val * indexToSecondsMap[i as keyof typeof indexToSecondsMap],
    0,
  );
};

/**
 * Read explicit status from json
 */
const readExplicit = (ctx: any): boolean => {
  const data = ctx['itunes:explicit'];
  if (!Array.isArray(data)) {
    return false;
  }
  switch (data[0]) {
    case 'no':
    case 'clean':
      return false;
    case 'yes':
      return true;
    default:
      return false;
  }
};

/**
 * Read episode artwork if present
 */
const readEpisodeArtwork = (ctx: any): string | null => {
  try {
    const url = ctx['media:content'][0]['$'].url;
    const type: string | null =
      (ctx['media:content'][0] &&
        ctx['media:content'][0]['$'] &&
        ctx['media:content'][0]['$'].type) ||
      null;

    if (type && type.includes('image')) {
      return url;
    } else {
      return null;
    }
  } catch (err) {
    return null;
  }
};

/**
 * Read keywords from json
 */
const readKeywords = (ctx: any): string[] => {
  const data = ctx['itunes:keywords'];
  if (!Array.isArray(data)) {
    return [];
  }
  const record = data[0];
  if (typeof record === 'string') {
    return record.split(',').map((e) => e.trim());
  } else if (typeof record === 'object') {
    return record['_'].split(',').map((e: string) => e.trim());
  }
  return [];
};

/**
 * Read show notes
 */
const readShowNotes = (ctx: any): string => {
  const description = (Array.isArray(ctx['description']) && ctx['description'][0]) || '';
  const contentEncoded =
    (Array.isArray(ctx['content:encoded']) &&
      (ctx['content:encoded'][0]['_'] || ctx['content:encoded'][0])) ||
    '';
  const summary = readSummary(ctx) || '';

  const notes = [description, contentEncoded, summary].sort(showNotesSorter);
  return reformatShowNotes(notes[notes.length - 1]).trim();
};

/**
 * Read cover
 */
const readCover = (ctx: any, baseLink?: string | null): string | null => {
  try {
    const data = ctx['itunes:image'];
    const link = data[0]['$']['href'];

    try {
      return new URL(link).toString();
    } catch (err) {
      if (baseLink) {
        return new URL(link, baseLink).toString();
      }
      return null;
    }
  } catch (err) {
    return null;
  }
};

/**
 * Read link
 */
const readLink = (ctx: any): string | null => {
  const link = Array.isArray(ctx.link) ? (ctx.link[0] as string) : null;
  return link || ctx['guid'][0]['_'];
};

/**
 * Read GUID
 */
const readGuid = (ctx: any): string => {
  const guid = ctx['guid'][0];
  return guid['_'] || guid;
};

/**
 * Adapt episode json to formatted one
 */
const adaptEpisode = (
  item: any,
  fallbackCover: string,
  fallbackAuthor: string,
): IEpisode | null => {
  if (!item['enclosure']) {
    return null;
  }

  const guid = readGuid(item);
  const link = readLink(item);

  return {
    guid,
    title: item.title[0] as string,
    summary: readSummary(item),
    published: readDate(item),
    cover: readCover(item, link) || fallbackCover,
    explicit: readExplicit(item),
    duration: readDuration(item),
    link,
    file: readFile(item['enclosure'][0]['$']),
    author:
      (Array.isArray(item['itunes:author']) ? (item['itunes:author'][0] as string) : null) ||
      fallbackAuthor,
    episodeArt: readEpisodeArtwork(item),
    showNotes: readShowNotes(item),
  };
};

/**
 * Helper funciton to parse xml to json via promises
 */
const xmlToJSON = (xml: string) => {
  return new Promise((resolve, reject) => {
    const { parseString } = new Parser();
    parseString(xml, (err, res) => (err ? reject(err) : resolve(res)));
  });
};

/**
 * Adapt json to better format
 */
const adaptJSON = (json: any): IEpisodeListing | null => {
  try {
    const channel = json.rss.channel[0];
    const cover = readCover(channel) as string;
    const author = channel['itunes:author'][0];
    return {
      title: channel.title[0].trim(),
      link: channel.link[0],
      published: readDate(channel),
      description: readDescription(channel),
      author: author,
      cover: cover,
      keywords: readKeywords(channel),
      explicit: readExplicit(channel),
      episodes: (channel['item'] as Array<any>)
        .map((e) => adaptEpisode(e, cover, author))
        .filter(validEpisode),
    };
  } catch (err) {
    console.log(err);
    return null;
  }
};

/**
 * Adapt xml to cleaned up json
 */
export const adaptFeed = async (xml: string) => xmlToJSON(xml).then(adaptJSON);

/**
 * Filters null feeds out
 */
const validEpisode = (e: IEpisode | null): e is IEpisode => e !== null;
