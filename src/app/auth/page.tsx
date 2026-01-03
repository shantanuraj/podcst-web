'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  useDiscoverableLogin,
  useEmailLogin,
  useLoginCheck,
  usePasskeyLogin,
  useRegister,
  useSendCode,
  useSession,
} from '@/shared/auth/useAuth';
import { useTranslation } from '@/shared/i18n';

import styles from './Auth.module.css';

const redirectTo = '/profile/subscriptions';

type Mode = 'email-login' | 'login-code' | 'signup-code' | 'passkey-setup';

export default function AuthPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: user, isLoading } = useSession();

  const discoverableLogin = useDiscoverableLogin();
  const loginCheck = useLoginCheck();
  const passkeyLogin = usePasskeyLogin();
  const sendCode = useSendCode();
  const emailLogin = useEmailLogin();
  const register = useRegister();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<Mode>('email-login');
  const [isSignup, setIsSignup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passkeyAttempted = useRef(false);

  useEffect(() => {
    if (passkeyAttempted.current || isLoading || user) return;
    passkeyAttempted.current = true;

    discoverableLogin
      .mutateAsync()
      .then(() => {
        router.push(redirectTo);
      })
      .catch(() => {});
  }, [isLoading, user]);

  if (isLoading) return null;

  if (user) {
    router.replace(redirectTo);
    return null;
  }

  const isPending =
    loginCheck.isPending ||
    passkeyLogin.isPending ||
    sendCode.isPending ||
    emailLogin.isPending ||
    register.isPending;

  const handleEmailLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const result = await loginCheck.mutateAsync(email);

      if (!result.exists) {
        setError(t('auth.noAccountFound'));
        return;
      }

      if (result.hasPasskey) {
        try {
          await passkeyLogin.mutateAsync({
            options: result.options,
            userId: result.userId,
          });
          router.push(redirectTo);
          return;
        } catch {
          await sendCode.mutateAsync(email);
          setMode('login-code');
          return;
        }
      }

      await sendCode.mutateAsync(email);
      setMode('login-code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const result = await loginCheck.mutateAsync(email);

      if (result.exists) {
        setError(t('auth.accountExists'));
        return;
      }

      await sendCode.mutateAsync(email);
      setMode('signup-code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await emailLogin.mutateAsync({ email, code });
      setMode('passkey-setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  const handleSetupPasskey = async () => {
    setError(null);

    try {
      await register.mutateAsync(email);
      router.push(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey setup failed');
    }
  };

  const handleSkipPasskey = () => {
    router.push(redirectTo);
  };

  const resetForm = () => {
    setMode('email-login');
    setEmail('');
    setCode('');
    setError(null);
    setIsSignup(false);
  };

  if (mode === 'passkey-setup') {
    return (
      <main className={styles.container}>
        <div className={styles.card}>
          <h1 className={styles.title}>{t('auth.setupPasskey')}</h1>
          <p className={styles.subtitle}>{t('auth.setupPasskeySubtitle')}</p>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.form}>
            <button
              type="button"
              onClick={handleSetupPasskey}
              disabled={isPending}
              className={styles.button}
            >
              {isPending ? t('auth.settingUp') : t('auth.setupPasskey')}
            </button>

            <button
              type="button"
              onClick={handleSkipPasskey}
              disabled={isPending}
              className={styles.link}
            >
              {t('auth.skipForNow')}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (mode === 'login-code' || mode === 'signup-code') {
    return (
      <main className={styles.container}>
        <div className={styles.card}>
          <h1 className={styles.title}>{t('auth.enterCode')}</h1>
          <p className={styles.subtitle}>
            {t('auth.verifySubtitle', { email })}
          </p>

          <form onSubmit={handleCodeSubmit} className={styles.form}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ''));
                setError(null);
              }}
              placeholder={t('auth.codePlaceholder')}
              required
              disabled={isPending}
              className={styles.input}
              style={{ textAlign: 'center', letterSpacing: '0.5em' }}
            />

            {error && <p className={styles.error}>{error}</p>}

            <button
              type="submit"
              disabled={isPending || code.length !== 6}
              className={styles.button}
            >
              {isPending ? t('auth.verifying') : t('auth.verify')}
            </button>
          </form>

          <button type="button" onClick={resetForm} className={styles.link}>
            {t('auth.useADifferentEmail')}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          {isSignup ? t('auth.createAccount') : t('auth.signIn')}
        </h1>
        <p className={styles.subtitle}>
          {isSignup
            ? t('auth.createAccountSubtitle')
            : t('auth.signInSubtitle')}
        </p>

        <form
          onSubmit={isSignup ? handleSignupSubmit : handleEmailLoginSubmit}
          className={styles.form}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder={t('auth.emailPlaceholder')}
            required
            disabled={isPending}
            className={styles.input}
          />

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" disabled={isPending} className={styles.button}>
            {isPending ? t('auth.continuing') : t('auth.continue')}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setIsSignup(!isSignup);
            setError(null);
          }}
          className={styles.link}
        >
          {isSignup ? t('auth.haveAccount') : t('auth.noAccount')}
        </button>
      </div>
    </main>
  );
}
