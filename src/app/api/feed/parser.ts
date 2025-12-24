/**
 * Parser for XML Podcast Feeds
 * Handles iTunes tags and various RSS/Atom structures
 */

import { Parser } from 'xml2js';
import type { IEpisode, IEpisodeListing, IFileInfo } from '@/types';
import { reformatShowNotes, showNotesSorter } from './format';

/**
 * Read enclosure/file properties
 */
const readFile = (file: any): IFileInfo => {
  const length = parseInt(file.length, 10);
  return {
    url: file.url || '',
    type: file.type || '',
    length: isNaN(length) ? 0 : length,
  };
};

/**
 * Read date from XML context (handles pubDate and lastBuildDate)
 */
const readDate = (ctx: any): number | null => {
  const data = ctx.pubDate || ctx.lastBuildDate;
  if (!Array.isArray(data) || !data[0]) {
    return null;
  }
  const dateStr = typeof data[0] === 'object' ? data[0]._ : data[0];
  if (!dateStr) return null;

  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date.getTime();
};

/**
 * Read summary from iTunes summary or subtitle tags
 */
const readSummary = (ctx: any): string | null => {
  const data = ctx['itunes:summary'] || ctx['itunes:subtitle'];
  if (Array.isArray(data) && data[0]) {
    const val = typeof data[0] === 'object' ? data[0]._ || '' : data[0];
    return typeof val === 'string' ? val.trim() : null;
  }
  return null;
};

/**
 * Read description from RSS description tag, falls back to summary
 */
const readDescription = (ctx: any): string => {
  const data = ctx.description;
  if (!Array.isArray(data) || !data[0]) {
    return readSummary(ctx) || '';
  }
  const val = typeof data[0] === 'object' ? data[0]._ || '' : data[0];
  return typeof val === 'string' ? val.trim() : '';
};

/**
 * Read duration and convert to seconds
 * Handles HH:MM:SS, MM:SS, and plain seconds
 */
const readDuration = (ctx: any): number | null => {
  const _data = ctx['itunes:duration'];
  if (!_data || !Array.isArray(_data) || !_data[0]) {
    return null;
  }

  const rawData = typeof _data[0] === 'object' ? _data[0]._ : _data[0];
  if (typeof rawData === 'number') return rawData;
  if (typeof rawData !== 'string') return null;

  const data = rawData.trim();
  if (!data) return null;

  if (data.indexOf(':') === -1) {
    const parsed = parseInt(data, 10);
    return isNaN(parsed) ? null : parsed;
  }

  const parts = data.split(':').map((e) => parseInt(e.trim(), 10));
  if (parts.some(isNaN)) {
    return null;
  }

  let seconds = 0;
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    seconds = parts[0];
  }

  return seconds;
};

/**
 * Read explicit status
 */
const readExplicit = (ctx: any): boolean => {
  const data = ctx['itunes:explicit'];
  if (!Array.isArray(data) || !data[0]) {
    return false;
  }
  const val = String(typeof data[0] === 'object' ? data[0]._ : data[0])
    .toLowerCase()
    .trim();
  return val === 'yes' || val === 'true' || val === 'explicit' || val === '1';
};

/**
 * Read episode artwork from media:content or itunes:image
 */
const readEpisodeArtwork = (ctx: any): string | null => {
  try {
    const mediaContent = ctx['media:content'];
    if (Array.isArray(mediaContent)) {
      for (const content of mediaContent) {
        if (content?.$?.type?.includes('image') && content.$.url) {
          return content.$.url;
        }
      }
    }

    const itunesImage = ctx['itunes:image'];
    if (Array.isArray(itunesImage) && itunesImage[0]?.$.href) {
      return itunesImage[0].$.href;
    }

    return null;
  } catch (_err) {
    return null;
  }
};

/**
 * Read keywords from iTunes keywords tag
 */
const readKeywords = (ctx: any): string[] => {
  const data = ctx['itunes:keywords'];
  if (!Array.isArray(data) || !data[0]) {
    return [];
  }
  const record = data[0];
  const words = typeof record === 'object' ? record._ : record;
  if (typeof words === 'string') {
    return words
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
  }
  return [];
};

/**
 * Extract show notes by picking the best available text
 */
const readShowNotes = (ctx: any): string => {
  const description = (Array.isArray(ctx.description) && ctx.description[0]) || '';
  const contentEncoded =
    (Array.isArray(ctx['content:encoded']) &&
      (ctx['content:encoded'][0]._ || ctx['content:encoded'][0])) ||
    '';
  const summary = readSummary(ctx) || '';

  const notes = [
    typeof description === 'object' ? description._ || '' : description,
    typeof contentEncoded === 'object' ? contentEncoded._ || '' : contentEncoded,
    summary,
  ].sort(showNotesSorter);

  return reformatShowNotes(notes[notes.length - 1] || '').trim();
};

/**
 * Read cover art and wrap in proxy if needed
 */
const readCover = (ctx: any, baseLink?: string | null): string | null => {
  try {
    let link = '';
    const itunesImage = ctx['itunes:image'];

    if (Array.isArray(itunesImage) && itunesImage[0]) {
      if (itunesImage[0].$?.href) {
        link = itunesImage[0].$.href;
      } else {
        const val = typeof itunesImage[0] === 'object' ? itunesImage[0]._ : itunesImage[0];
        if (typeof val === 'string') {
          link = val.trim();
        }
      }
    }

    if (!link) {
      // Fallback to channel image if available
      const channelImage = ctx.image;
      if (Array.isArray(channelImage) && channelImage[0]?.url?.[0]) {
        link =
          typeof channelImage[0].url[0] === 'object'
            ? channelImage[0].url[0]._
            : channelImage[0].url[0];
      }
    }

    if (!link) return null;

    let url: URL;
    try {
      url = new URL(link);
    } catch (_err) {
      if (baseLink) {
        try {
          url = new URL(link, baseLink);
        } catch (__err) {
          return null;
        }
      } else {
        return null;
      }
    }

    const imgProxy = new URL('https://assets.podcst.app/');
    imgProxy.searchParams.set('p', url.toString());
    return imgProxy.toString();
  } catch (_err) {
    return null;
  }
};

/**
 * Read link from RSS link tag or GUID
 */
const readLink = (ctx: any): string | null => {
  if (Array.isArray(ctx.link)) {
    const link = ctx.link[0];
    if (typeof link === 'string') return link;
    if (typeof link === 'object' && link.$.href) return link.$.href;
  }
  if (Array.isArray(ctx.guid) && ctx.guid[0]) {
    const guid = ctx.guid[0];
    const guidVal = typeof guid === 'object' ? guid._ || guid : guid;
    // Only use GUID as link if it looks like a URL
    if (typeof guidVal === 'string' && guidVal.startsWith('http')) {
      return guidVal;
    }
  }
  return null;
};

/**
 * Read GUID for an episode
 */
const readGuid = (ctx: any): string => {
  if (Array.isArray(ctx.guid) && ctx.guid[0]) {
    const guid = ctx.guid[0];
    return (typeof guid === 'object' ? guid._ || guid : guid || '').toString();
  }
  return '';
};

/**
 * Adapt episode JSON to internal IEpisode format
 */
const adaptEpisode = (
  item: any,
  fallbackCover: string,
  fallbackAuthor: string,
): IEpisode | null => {
  if (!item.enclosure || !Array.isArray(item.enclosure) || !item.enclosure[0]?.$) {
    return null;
  }

  const guid = readGuid(item);
  const titleRaw = Array.isArray(item.title) ? item.title[0] : item.title;
  const title = (typeof titleRaw === 'object' ? titleRaw._ : titleRaw) || 'Untitled Episode';

  if (!guid && (!title || title === 'Untitled Episode')) {
    return null;
  }

  const link = readLink(item);

  return {
    guid,
    title: title.toString().trim(),
    summary: readSummary(item),
    published: readDate(item),
    cover: readCover(item, link) || fallbackCover,
    explicit: readExplicit(item),
    duration: readDuration(item),
    link,
    file: readFile(item.enclosure[0].$),
    author:
      (Array.isArray(item['itunes:author']) ? (item['itunes:author'][0] as string) : null) ||
      fallbackAuthor,
    episodeArt: readEpisodeArtwork(item),
    showNotes: readShowNotes(item),
  };
};

/**
 * Parse XML string to JSON using xml2js
 */
const xmlToJSON = (xml: string) => {
  return new Promise((resolve, reject) => {
    const { parseString } = new Parser({
      trim: true,
      explicitArray: true,
      normalize: true,
    });
    parseString(xml, (err, res) => (err ? reject(err) : resolve(res)));
  });
};

/**
 * Transform parsed XML JSON into IEpisodeListing
 */
const adaptJSON = (json: any): IEpisodeListing | null => {
  if (!json?.rss?.channel?.[0]) {
    console.error('Invalid Podcast RSS: Missing channel');
    return null;
  }

  try {
    const channel = json.rss.channel[0];
    const cover = (readCover(channel) || '') as string;

    const author =
      (Array.isArray(channel['itunes:author']) ? channel['itunes:author'][0] : null) ||
      (Array.isArray(channel['itunes:owner'])
        ? channel['itunes:owner'][0]?.['itunes:name']?.[0]
        : null) ||
      'Unknown Author';

    const titleRaw = Array.isArray(channel.title) ? channel.title[0] : channel.title;
    const title = (typeof titleRaw === 'object' ? titleRaw._ : titleRaw) || 'Unknown Podcast';

    return {
      title: title.toString().trim(),
      link: channel.link?.[0] ?? '',
      published: readDate(channel),
      description: readDescription(channel),
      author: author.toString().trim(),
      cover: cover,
      keywords: readKeywords(channel),
      explicit: readExplicit(channel),
      episodes: Array.isArray(channel.item)
        ? channel.item.map((e: any) => adaptEpisode(e, cover, author)).filter(validEpisode)
        : [],
    };
  } catch (err) {
    console.error('Error adapting podcast JSON:', err);
    return null;
  }
};

/**
 * Main entry point: parses XML and adapts to cleaned up JSON
 */
export const adaptFeed = async (xml: string) => xmlToJSON(xml).then(adaptJSON);

/**
 * Type guard for valid episodes
 */
const validEpisode = (e: IEpisode | null): e is IEpisode => e !== null;
