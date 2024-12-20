'use client';

import React from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useSubscriptions, SubscriptionsState } from '@/shared/subscriptions/useSubscriptions';
import { Button } from '@/ui/Button';

import styles from '@/app/settings/Settings.module.css';

export default function SettingsExportPage() {
  const subs = useSubscriptions(useShallow(getExportList));
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

    let xmlStr = `<?xml version="1.0" encoding="utf-8" standalone="no"?>\n`;
    xmlStr += new XMLSerializer().serializeToString(opml);

    const blob = new Blob([xmlStr], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'podcst-subscriptions.opml';
    link.click();
  }, [subs]);
  return (
    <div className={`${styles.container} ${styles.export}`}>
      <Button onClick={exportSubscriptions}>Export subscriptions as OPML</Button>
    </div>
  );
}

const getExportList = (state: SubscriptionsState) =>
  Object.values(state.subs).map((sub) => ({
    title: sub.title,
    feed: sub.feed,
  }));
