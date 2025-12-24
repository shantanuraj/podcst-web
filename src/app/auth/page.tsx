'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, useLogin, useRegister } from '@/shared/auth/useAuth';

import styles from './Auth.module.css';

const redirectTo = '/profile/subscriptions';

export default function AuthPage() {
  const router = useRouter();
  const { data: user, isLoading } = useSession();
  const login = useLogin();
  const register = useRegister();

  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<'initial' | 'register'>('initial');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'register') {
      register
        .mutateAsync(email)
        .then(() => router.push(redirectTo))
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to create passkey'));
    }
  }, [mode]);

  if (isLoading) {
    return null;
  }

  if (user) {
    router.replace(redirectTo);
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      await login.mutateAsync(email);
      router.push(redirectTo);
    } catch {
      setMode('register');
    }
  };

  const isPending = login.isPending || register.isPending;

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Sign In</h1>
        <p className={styles.subtitle}>Use your email to continue with a passkey</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setMode('initial');
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
            {isPending ? 'Authenticating...' : 'Continue'}
          </button>
        </form>
      </div>
    </main>
  );
}
