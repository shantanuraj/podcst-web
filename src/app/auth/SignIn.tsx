'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AccountUser } from '@/shared/auth/account';
import {
  useDiscoverableLogin,
  useEmailLogin,
  useRegister,
  useSendCode,
  useSession,
} from '@/shared/auth/useAuth';
import { useTranslation } from '@/shared/i18n';
import { ProxiedImage } from '@/ui/Image/ProxiedImage';
import { Icon } from '@/ui/icons/svg/Icon';

import styles from './Auth.module.css';

const landing = '/library';

const failure = (error: unknown) =>
  error instanceof Error && error.name !== 'NotAllowedError'
    ? error.message
    : null;

function useAttempt() {
  const [error, setError] = useState<string | null>(null);
  const attempt = (action: () => Promise<unknown>) => {
    setError(null);
    action().catch((cause: unknown) => setError(failure(cause)));
  };
  return { error, attempt, clear: () => setError(null) };
}

export function SignIn({ covers }: { covers: string[] }) {
  const { data: user, isLoading } = useSession();
  return (
    <main className={styles.page}>
      <div className={styles.mosaic} aria-hidden>
        <div className={styles.drift}>
          {[0, 1].map((copy) => (
            <div key={copy} className={styles.tiles}>
              {covers.map((cover) => (
                <ProxiedImage
                  key={`${copy}${cover}`}
                  alt=""
                  src={cover}
                  sizes="180px"
                  loading={copy ? 'lazy' : 'eager'}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.panel}>
        {isLoading ? null : user ? <PasskeySetup user={user} /> : <Guest />}
      </div>
    </main>
  );
}

function Guest() {
  const { t } = useTranslation();
  const discoverableLogin = useDiscoverableLogin();
  const sendCode = useSendCode();
  const emailLogin = useEmailLogin();
  const { error, attempt, clear } = useAttempt();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const isPending =
    discoverableLogin.isPending || sendCode.isPending || emailLogin.isPending;

  if (sent)
    return (
      <>
        <h1 className={styles.title}>{t('auth.enterCode')}</h1>
        <p className={styles.subtitle}>{t('auth.verifySubtitle', { email })}</p>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            attempt(() => emailLogin.mutateAsync({ email, code }));
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            aria-label={t('auth.enterCode')}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, ''));
              clear();
            }}
            placeholder={t('auth.codePlaceholder')}
            required
            disabled={isPending}
            className={`${styles.input} ${styles.code}`}
          />
          <button
            type="submit"
            disabled={isPending || code.length !== 6}
            className={styles.primary}
          >
            {isPending ? t('auth.verifying') : t('auth.verify')}
          </button>
        </form>
        {error && <p className={styles.error}>{error}</p>}
        <button
          type="button"
          className={styles.link}
          onClick={() => {
            setSent(false);
            setCode('');
            clear();
          }}
        >
          {t('auth.useADifferentEmail')}
        </button>
      </>
    );

  return (
    <>
      <h1 className={styles.title}>{t('auth.title')}</h1>
      <p className={styles.subtitle}>{t('auth.subtitle')}</p>
      <button
        type="button"
        className={styles.primary}
        disabled={isPending}
        onClick={() => attempt(() => discoverableLogin.mutateAsync())}
      >
        <Icon icon="passkey" size={18} />
        {t('auth.passkey')}
      </button>
      <div className={styles.or}>{t('auth.or')}</div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          attempt(() => sendCode.mutateAsync(email).then(() => setSent(true)));
        }}
      >
        <input
          type="email"
          autoComplete="email webauthn"
          aria-label={t('auth.email')}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            clear();
          }}
          placeholder={t('auth.emailPlaceholder')}
          required
          disabled={isPending}
          className={styles.input}
        />
        <button type="submit" disabled={isPending} className={styles.secondary}>
          {sendCode.isPending ? t('auth.sending') : t('auth.sendCode')}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
      <p className={styles.note}>{t('auth.newHere')}</p>
    </>
  );
}

function PasskeySetup({ user }: { user: AccountUser }) {
  const router = useRouter();
  const { t } = useTranslation();
  const register = useRegister();
  const { error, attempt } = useAttempt();

  useEffect(() => {
    if (user.hasPasskey) router.replace(landing);
  }, [user.hasPasskey, router]);

  if (user.hasPasskey) return null;

  return (
    <>
      <h1 className={styles.title}>{t('auth.setupPasskey')}</h1>
      <p className={styles.subtitle}>{t('auth.setupPasskeySubtitle')}</p>
      <button
        type="button"
        className={styles.primary}
        disabled={register.isPending}
        onClick={() => attempt(() => register.mutateAsync(user.email))}
      >
        <Icon icon="passkey" size={18} />
        {register.isPending ? t('auth.settingUp') : t('auth.setupPasskey')}
      </button>
      {error && <p className={styles.error}>{error}</p>}
      <button
        type="button"
        className={styles.link}
        disabled={register.isPending}
        onClick={() => router.push(landing)}
      >
        {t('auth.skipForNow')}
      </button>
    </>
  );
}
