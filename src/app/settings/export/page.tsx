'use client';

import React from 'react';
import { type SubscriptionsState, useSubscriptions } from '@/shared/subscriptions/useSubscriptions';
import { Button } from '@/ui/Button';
import styles from '../Settings.module.css';

export default function SettingsExportPage() {
  const subsMap = useSubscriptions((state: SubscriptionsState) => state.subs);
  const subs = React.useMemo(
    () =>
      Object.values(subsMap).map((sub) => ({
        title: sub.title,
        feed: sub.feed,
      })),
    [subsMap],
  );

  // Generates the OPML format XML file from subscriptions.
  const exportSubscriptions = React.useCallback(() => {
    const doc = document.implementation.createDocument('', '', null);

    const opml = doc.createElement('opml');
    opml.setAttribute('version', '1.0');

    const head = doc.createElement('head');
    const title = doc.createElement('title');
    title.textContent = 'Podcst Subscriptions';
    head.appendChild(title);
    opml.appendChild(head);

    const body = doc.createElement('body');
    opml.appendChild(body);
    const feeds = doc.createElement('outline');
    feeds.setAttribute('text', 'feeds');
    body.appendChild(feeds);

    subs.forEach((sub) => {
      const outline = doc.createElement('outline');
      outline.setAttribute('text', sub.title);
      outline.setAttribute('xmlUrl', sub.feed);
      outline.setAttribute('type', 'rss');
      feeds.appendChild(outline);
    });

    let xmlStr = '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n';
    xmlStr += new XMLSerializer().serializeToString(opml);

    const blob = new Blob([xmlStr], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'podcst-subscriptions.opml';
    link.click();
  }, [subs]);

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.title}>Export Library</h1>
        </header>
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
          <div className="w-16 h-16 mb-6 text-ink-tertiary">
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3" />
            </svg>
          </div>
          <p className="text-base text-ink-secondary max-w-[40ch] mb-8 leading-relaxed">
            Download your subscriptions as an OPML file. You can use this file to import your
            podcasts into other applications.
          </p>
          <div className="flex flex-col items-center gap-4">
            <Button
              onClick={exportSubscriptions}
              className="px-8 py-4 text-base font-medium bg-ink text-surface border border-ink hover:bg-ink-secondary transition-all"
            >
              Download OPML File
            </Button>
            <p className="text-xs text-ink-tertiary">
              {subs.length} {subs.length === 1 ? 'podcast' : 'podcasts'} in your library
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
