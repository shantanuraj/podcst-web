import * as React from 'react';
import { fetchEpisodesInfo } from '../../data/episodes';

import { IOPMLFeed, IOPMLJson, IPodcastEpisodesInfo } from '../../types';
import { Button } from '../../ui/Button/Button';

import styles from './ImportButton.module.css';

interface ImportButtonProps {
  onImport: (episodes: IPodcastEpisodesInfo[]) => void;
}

export function ImportButton(props: ImportButtonProps) {
  const onImport = React.useMemo(
    () =>
      onFileImport(async (file) => {
        if (typeof file !== 'string') return;
        const { feeds } = opmltoJSON(file);
        const episodes: IPodcastEpisodesInfo[] = [];
        try {
          for (const item of feeds) {
            const info = await fetchEpisodesInfo(item.feed);
            if (info) episodes.push(info);
          }
          props.onImport(episodes);
        } catch (err) {
          console.error('Import failed', err);
        }
      }),
    [props.onImport],
  );

  return (
    <Button className={styles.button}>
      <input id="opml-import" accept=".xml, .opml" name="file" type="file" onChange={onImport} />
      <label htmlFor="opml-import">Upload OPML file</label>
    </Button>
  );
}

const onFileImport = (cb: (file: string | null | ArrayBuffer) => void) => {
  return (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = e.target as HTMLInputElement;
    const file = (target.files as FileList)[0];
    const reader = new FileReader();
    reader.onload = () => {
      cb(reader.result);
      target.value = '';
    };
    reader.readAsText(file);
  };
};

/**
 * Parse OPML XML to JSON feed
 */
export const opmltoJSON = (file: string): IOPMLJson => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(file, 'text/xml');
  const feeds = Array.from(xml.querySelectorAll('outline[type="rss"]')) as Element[];
  return {
    feeds: feeds.map(adaptFeed),
  };
};

/**
 * Extract OPML record
 */
const adaptFeed = (el: Element): IOPMLFeed => ({
  title: el.getAttribute('text') as string,
  feed: el.getAttribute('xmlUrl') as string,
});
