'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, useLogin, useRegister } from '@/shared/auth/useAuth';

import styles from './Auth.module.css';

export default function AuthPage() {
  const router = useRouter();
  const { data: user, isLoading } = useSession();
  const login = useLogin();
  const register = useRegister();

  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<'initial' | 'login' | 'register'>('initial');
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return null;
  }

  if (user) {
    router.replace('/subs');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'initial') {
      setMode('login');
      try {
        await login.mutateAsync(email);
        router.push('/subs');
      } catch {
        setMode('register');
      }
      return;
    }

    if (mode === 'register') {
      try {
        await register.mutateAsync(email);
        router.push('/subs');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Registration failed');
      }
      return;
    }

    if (mode === 'login') {
      try {
        await login.mutateAsync(email);
        router.push('/subs');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    }
  };

  const isPending = login.isPending || register.isPending;

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>{mode === 'register' ? 'Create Account' : 'Sign In'}</h1>
        <p className={styles.subtitle}>
          {mode === 'register'
            ? 'Create a passkey to secure your account'
            : 'Use your email to continue with a passkey'}
        </p>

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
            {isPending ? 'Continue...' : mode === 'register' ? 'Create Passkey' : 'Continue'}
          </button>
        </form>

        {mode === 'register' && (
          <p className={styles.hint}>No account found. We'll create one for you.</p>
        )}
      </div>
    </main>
  );
}
