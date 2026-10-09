'use client';

import { type ChangeEvent, useEffect, useId, useState } from 'react';
import { fetchEpisodesInfo } from '@/data/episodes';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { useSession } from '@/shared/auth/useAuth';
import { useTranslation } from '@/shared/i18n';
import { OPML_ERROR, readOpml } from '@/shared/opml';
import { useSyncToCloud } from '@/shared/subscriptions/useServerSubscriptions';
import { useSubscriptions } from '@/shared/subscriptions/useSubscriptions';
import styles from './OpmlImport.module.css';

type Result = { imported: number; failed: string[] | number };

export function OpmlImport({ className }: { className?: string }) {
  const { t } = useTranslation();
  const id = useId();
  const { data: user } = useSession();
  const session = useAccountSession();
  const pending = useSubscriptions((state) => state.imports);
  const syncToCloud = useSyncToCloud();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setResult(null);
    setError(undefined);
  }, [user?.id]);

  const importGuest = async (
    feeds: readonly string[],
    current: () => boolean,
  ) => {
    await useSubscriptions.getState().stageImports(feeds);
    let imported = 0;
    for (const feed of useSubscriptions.getState().imports) {
      if (!current()) break;
      const info = await fetchEpisodesInfo(feed).catch(() => null);
      if (!current()) break;
      if (info && !info.isPrivate) {
        await useSubscriptions
          .getState()
          .addSubscriptions([{ ...info, feed }], current, feed);
        imported++;
      }
    }
    return { imported, failed: useSubscriptions.getState().imports };
  };

  const run = async (feeds: readonly string[]) => {
    const token = session.token();
    const current = () => session.current(token);
    if (!feeds.length || !current() || token.scope !== (user?.id ?? null))
      return;
    setBusy(true);
    setError(undefined);
    try {
      const next = user
        ? await syncToCloud
            .mutateAsync([...feeds])
            .then(({ succeeded, failed }) => ({
              imported: succeeded,
              failed,
            }))
        : await importGuest(feeds, current);
      if (current()) setResult(next);
    } catch {
      if (current())
        setError('Import could not finish. Existing pending imports retained.');
    } finally {
      setBusy(false);
    }
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const token = session.token();
    try {
      const feeds = await readOpml(file);
      if (session.current(token)) await run(feeds);
    } catch {
      if (session.current(token)) setError(OPML_ERROR);
    }
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
      {error && <p role="alert">{error}</p>}
      {!user && !result && pending.length > 0 && !busy && (
        <button type="button" onClick={() => run(pending)}>
          {t('account.retryFailed')} ({pending.length})
        </button>
      )}
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
