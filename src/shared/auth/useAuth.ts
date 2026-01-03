import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import {
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type User = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

type SessionResponse = {
  user: User | null;
};

const getVisitorId = () => {
  if (typeof window === 'undefined') return '';
  let id = sessionStorage.getItem('visitorId');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('visitorId', id);
  }
  return id;
};

async function fetchSession(): Promise<User | null> {
  const res = await fetch('/api/auth/session');
  const data: SessionResponse = await res.json();
  return data.user;
}

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: fetchSession,
    staleTime: 5 * 60 * 1000,
  });
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
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ email, code }: { email: string; code: string }) => {
      const res = await fetch('/api/auth/email-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (email: string) => {
      const visitorId = getVisitorId();

      const optionsRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, visitorId }),
      });

      const { options, userId, error } = await optionsRes.json();
      if (error) throw new Error(error);

      const credential = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: credential, userId, visitorId }),
      });

      const result = await verifyRes.json();
      if (result.error) throw new Error(result.error);

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
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
  const queryClient = useQueryClient();

  return useMutation({
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
      if (result.error) throw new Error(result.error);

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
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
      if (result.error) throw new Error(result.error);

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

export function useDiscoverableLogin() {
  const queryClient = useQueryClient();

  return useMutation({
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
      if (result.error) throw new Error(result.error);

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}
