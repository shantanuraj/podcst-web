import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import {
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { useMutation } from '@tanstack/react-query';
import { useAccountSession } from './AccountBoundary';

function useAccountChange() {
  const session = useAccountSession();
  return {
    onMutate: () => session.beginAuthChange(),
    onSuccess: () => session.finishAuthChange(true),
    onError: () => session.finishAuthChange(false),
  };
}

const getVisitorId = () => {
  if (typeof window === 'undefined') return '';
  let id = sessionStorage.getItem('visitorId');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('visitorId', id);
  }
  return id;
};

export function useSession() {
  const session = useAccountSession();
  const state = session.getSnapshot();
  return {
    data: state.ready ? state.user : undefined,
    isLoading: !state.ready,
    isPending: !state.ready,
  };
}

export function useSendCode() {
  return useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
  });
}

export function useVerifyCode() {
  return useMutation({
    mutationFn: async ({ email, code }: { email: string; code: string }) => {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
  });
}

export function useEmailLogin() {
  const boundary = useAccountChange();
  return useMutation({
    ...boundary,
    mutationFn: async ({ email, code }: { email: string; code: string }) => {
      const res = await fetch('/api/auth/email-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok || data.error)
        throw new Error(data.error || 'Sign in failed');
      return data;
    },
  });
}

export function useRegister() {
  const boundary = useAccountChange();
  return useMutation({
    ...boundary,
    mutationFn: async (email: string) => {
      const visitorId = getVisitorId();
      const optionsRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, visitorId }),
      });
      const { options, error } = await optionsRes.json();
      if (error) throw new Error(error);
      const credential = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: credential, visitorId }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || result.error)
        throw new Error(result.error || 'Registration failed');
      return result;
    },
  });
}

type LoginCheckResult =
  | { exists: false }
  | { exists: true; hasPasskey: false; userId: string }
  | {
      exists: true;
      hasPasskey: true;
      options: PublicKeyCredentialRequestOptionsJSON;
      userId: string;
    };

export function useLoginCheck() {
  return useMutation({
    mutationFn: async (email: string): Promise<LoginCheckResult> => {
      const visitorId = getVisitorId();
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, visitorId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
  });
}

export function usePasskeyLogin() {
  const boundary = useAccountChange();
  return useMutation({
    ...boundary,
    mutationFn: async ({
      options,
      userId,
    }: {
      options: PublicKeyCredentialRequestOptionsJSON;
      userId: string;
    }) => {
      const visitorId = getVisitorId();
      const credential = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: credential, userId, visitorId }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || result.error)
        throw new Error(result.error || 'Sign in failed');
      return result;
    },
  });
}

export function useLogin() {
  const boundary = useAccountChange();
  return useMutation({
    ...boundary,
    mutationFn: async (email: string) => {
      const visitorId = getVisitorId();
      const optionsRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, visitorId }),
      });
      const { options, userId, error } = await optionsRes.json();
      if (error) throw new Error(error);
      const credential = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: credential, userId, visitorId }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || result.error)
        throw new Error(result.error || 'Sign in failed');
      return result;
    },
  });
}

export function useLogout() {
  const boundary = useAccountChange();
  return useMutation({
    ...boundary,
    mutationFn: async () => {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Unable to sign out');
    },
  });
}

export function useDiscoverableLogin() {
  const boundary = useAccountChange();
  return useMutation({
    ...boundary,
    mutationFn: async () => {
      const visitorId = getVisitorId();
      const optionsRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId, discoverable: true }),
      });
      const { options, error } = await optionsRes.json();
      if (error) throw new Error(error);
      const credential = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: credential, visitorId }),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok || result.error)
        throw new Error(result.error || 'Sign in failed');
      return result;
    },
  });
}
