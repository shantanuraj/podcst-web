'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useSession,
  useLogin,
  useRegister,
  useSendCode,
  useVerifyCode,
} from '@/shared/auth/useAuth';

import styles from './Auth.module.css';

const redirectTo = '/profile/subscriptions';

type Mode = 'email' | 'code' | 'passkey';

export default function AuthPage() {
  const router = useRouter();
  const { data: user, isLoading } = useSession();
  const login = useLogin();
  const register = useRegister();
  const sendCode = useSendCode();
  const verifyCode = useVerifyCode();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<Mode>('email');
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return null;
  }

  if (user) {
    router.replace(redirectTo);
    return null;
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await login.mutateAsync(email);
      router.push(redirectTo);
    } catch {
      try {
        await sendCode.mutateAsync(email);
        setMode('code');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send code');
      }
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await verifyCode.mutateAsync({ email, code });
      setMode('passkey');
      await register.mutateAsync(email);
      router.push(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  const isPending =
    login.isPending ||
    register.isPending ||
    sendCode.isPending ||
    verifyCode.isPending;

  if (mode === 'code' || mode === 'passkey') {
    return (
      <main className={styles.container}>
        <div className={styles.card}>
          <h1 className={styles.title}>
            {mode === 'passkey' ? 'Create Passkey' : 'Enter Code'}
          </h1>
          <p className={styles.subtitle}>
            {mode === 'passkey'
              ? 'Creating your passkey...'
              : `We sent a code to ${email}`}
          </p>

          {mode === 'code' && (
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
                placeholder="000000"
                required
                autoFocus
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
                {isPending ? 'Verifying...' : 'Verify'}
              </button>
            </form>
          )}

          {mode === 'passkey' && !error && (
            <p className={styles.subtitle}>
              Follow the prompts to create your passkey
            </p>
          )}

          {error && mode === 'passkey' && (
            <p className={styles.error}>{error}</p>
          )}

          <button
            type="button"
            onClick={() => {
              setMode('email');
              setCode('');
              setError(null);
            }}
            className={styles.link}
          >
            Use a different email
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Sign In</h1>
        <p className={styles.subtitle}>
          Use your email to continue with a passkey
        </p>

        <form onSubmit={handleEmailSubmit} className={styles.form}>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder="you@example.com"
            required
            autoFocus
            disabled={isPending}
            className={styles.input}
          />

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" disabled={isPending} className={styles.button}>
            {isPending ? 'Continue...' : 'Continue'}
          </button>
        </form>
      </div>
    </main>
  );
}
