'use client';

import { type ChangeEvent, useId, useState } from 'react';
import { fetchEpisodesInfo } from '@/data/episodes';
import { useSession } from '@/shared/auth/useAuth';
import { useTranslation } from '@/shared/i18n';
import { opmlFeeds } from '@/shared/opml';
import { useSyncToCloud } from '@/shared/subscriptions/useServerSubscriptions';
import { useSubscriptions } from '@/shared/subscriptions/useSubscriptions';
import type { IPodcastEpisodesInfo } from '@/types';
import styles from './OpmlImport.module.css';

type Result = { imported: number; failed: string[] | number };

export function OpmlImport({ className }: { className?: string }) {
  const { t } = useTranslation();
  const id = useId();
  const { data: user } = useSession();
  const syncToCloud = useSyncToCloud();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const importGuest = async (feeds: readonly string[]) => {
    const imported: IPodcastEpisodesInfo[] = [];
    const failed: string[] = [];
    for (const feed of feeds) {
      const info = await fetchEpisodesInfo(feed).catch(() => null);
      if (info && !info.isPrivate) imported.push({ ...info, feed });
      else failed.push(feed);
    }
    useSubscriptions.getState().addSubscriptions(imported);
    return { imported: imported.length, failed };
  };

  const run = async (feeds: readonly string[]) => {
    if (!feeds.length) return;
    setBusy(true);
    try {
      setResult(
        user
          ? await syncToCloud
              .mutateAsync([...feeds])
              .then(({ succeeded, failed }) => ({
                imported: succeeded,
                failed,
              }))
          : await importGuest(feeds),
      );
    } catch {
      setResult({ imported: 0, failed: user ? feeds.length : [...feeds] });
    } finally {
      setBusy(false);
    }
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (file) await run(opmlFeeds(await file.text()));
  };

  const failed = result?.failed;
  const failedCount = Array.isArray(failed) ? failed.length : (failed ?? 0);

  return (
    <div className={`${styles.import} ${className ?? ''}`}>
      <input
        id={id}
        type="file"
        accept=".opml,.xml,text/xml,text/x-opml"
        onChange={choose}
        disabled={busy}
        className={styles.file}
      />
      <label htmlFor={id} className={styles.button} data-busy={busy}>
        {busy ? t('account.importing') : t('account.importOpml')}
      </label>
      {result && (
        <p role="status" className={styles.status}>
          {t('account.importResult', {
            imported: result.imported,
            failed: failedCount,
          })}
          {Array.isArray(failed) && failed.length > 0 && !busy && (
            <button type="button" onClick={() => run(failed)}>
              {t('account.retryFailed')}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
