'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { AccountDeletion } from '@/shared/account-deletion';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { deletionRuntime } from '@/shared/auth/deletion-browser';
import styles from './Account.module.css';

export function DeleteAccount() {
  const session = useAccountSession();
  const { storage, coordinator } = deletionRuntime(session);
  const [records, setRecords] = useState<AccountDeletion[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const user = session.getSnapshot().user;
  const active = records.find((record) => record.accountId === user?.id);
  const reload = useCallback(() => {
    try {
      setRecords(storage.records());
    } catch {
      setError(
        'Saved deletion status could not be read. Your retained data has been preserved.',
      );
    }
  }, [storage]);
  useEffect(() => {
    reload();
    return storage.subscribe(reload);
  }, [storage, reload]);
  const attempt = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to complete deletion. Try again.',
      );
    } finally {
      setBusy(false);
      reload();
    }
  };
  return (
    <div className={styles.deletion}>
      <p>
        Permanently delete your Podcst account, sign-in credentials, follows,
        listening history, Starred episodes, preferences and private feeds. This
        cannot be undone.
      </p>
      <p className={styles.description}>
        After confirmation, this browser removes the account’s saved data. Other
        devices and exported copies may retain data. Publisher subscriptions and
        audio are unaffected.{' '}
        <Link href="/privacy#deletion">Data retention details</Link>
      </p>
      {user && !active && (
        <button
          type="button"
          className={styles.outline}
          disabled={busy || session.verifiedAccount !== user.id}
          onClick={() => attempt(() => coordinator.prepare(user.id))}
        >
          Send deletion code
        </button>
      )}
      {!user && (
        <Link href="/auth?next=delete" className={styles.outline}>
          Sign in to delete your account
        </Link>
      )}
      {records.map((record) => (
        <div key={record.accountId} className={styles.deletionRequest}>
          <p role="status">
            {record.cleanup?.next === 'complete'
              ? 'Your account has been deleted and its saved data removed from this browser.'
              : record.outcome === 'completed'
                ? 'Your account has been deleted. Cleanup on this browser still needs to finish.'
                : record.outcome === 'unsubmitted'
                  ? 'Enter the deletion code sent to your account email. It expires after five minutes.'
                  : record.outcome === 'pending'
                    ? 'Your deletion request has been accepted. Checking for completion…'
                    : 'Deletion is not yet confirmed. Check its status before trying again. Your saved data is retained.'}
          </p>
          {record.operation &&
            record.accountId === user?.id &&
            ['unsubmitted', 'unknown'].includes(record.outcome) &&
            !record.cleanup && (
              <DeletionProof
                key={record.operation.operationId}
                email={user.email}
                busy={busy}
                submit={(code) =>
                  attempt(async () => {
                    const result = await coordinator.submit(
                      record.accountId,
                      code,
                    );
                    if (result.outcome === 'unsubmitted')
                      throw new Error(
                        'Invalid or expired deletion code. Try again, or cancel to request a new code.',
                      );
                  })
                }
              />
            )}
          {record.outcome === 'unsubmitted' && (
            <button
              type="button"
              className={styles.outline}
              disabled={busy}
              onClick={() =>
                attempt(() => coordinator.cancel(record.accountId))
              }
            >
              Cancel
            </button>
          )}
          {record.outcome === 'unknown' && record.accountId === user?.id && (
            <button
              type="button"
              className={styles.outline}
              disabled={busy || session.verifiedAccount !== user.id}
              onClick={() =>
                attempt(() => coordinator.prepare(record.accountId))
              }
            >
              Request a new deletion code
            </button>
          )}
          {record.outcome !== 'unsubmitted' &&
            record.cleanup?.next !== 'complete' && (
              <button
                type="button"
                className={styles.outline}
                disabled={busy}
                onClick={() =>
                  attempt(() => coordinator.check(record.accountId))
                }
              >
                {record.outcome === 'completed'
                  ? 'Retry cleanup'
                  : 'Check deletion status'}
              </button>
            )}
        </div>
      ))}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

function DeletionProof({
  email,
  busy,
  submit,
}: {
  email: string;
  busy: boolean;
  submit: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmed) void submit(code);
      }}
    >
      <label>
        Deletion code
        <input
          className={styles.select}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />{' '}
        Permanently delete {email} and its data.
      </label>
      <button
        type="submit"
        className={styles.primary}
        disabled={busy || !confirmed || !/^\d{6}$/.test(code)}
      >
        Delete account permanently
      </button>
    </form>
  );
}
