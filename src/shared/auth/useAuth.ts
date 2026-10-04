import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import {
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { useMutation } from '@tanstack/react-query';
import { post } from '@/data/api';
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
      return post('/auth/verify', { email });
    },
  });
}

export function useVerifyCode() {
  return useMutation({
    mutationFn: async ({ email, code }: { email: string; code: string }) => {
      return post('/auth/verify', { email, code });
    },
  });
}

export function useEmailLogin() {
  const boundary = useAccountChange();
  return useMutation({
    ...boundary,
    mutationFn: async ({ email, code }: { email: string; code: string }) => {
      return post('/auth/email-login', { email, code });
    },
  });
}

export function useRegister() {
  const boundary = useAccountChange();
  return useMutation({
    ...boundary,
    mutationFn: async (email: string) => {
      const visitorId = getVisitorId();
      const { options } = await post<{
        options: PublicKeyCredentialCreationOptionsJSON;
      }>('/auth/register', { email, visitorId });
      const credential = await startRegistration({ optionsJSON: options });
      return post('/auth/register', { response: credential, visitorId });
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
      return post('/auth/login', { email, visitorId });
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
      return post('/auth/login', { response: credential, userId, visitorId });
    },
  });
}

export function useLogin() {
  const boundary = useAccountChange();
  return useMutation({
    ...boundary,
    mutationFn: async (email: string) => {
      const visitorId = getVisitorId();
      const { options, userId } = await post<{
        options: PublicKeyCredentialRequestOptionsJSON;
        userId: string;
      }>('/auth/login', { email, visitorId });
      const credential = await startAuthentication({ optionsJSON: options });
      return post('/auth/login', { response: credential, userId, visitorId });
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
      const { options } = await post<{
        options: PublicKeyCredentialRequestOptionsJSON;
      }>('/auth/login', { visitorId, discoverable: true });
      const credential = await startAuthentication({ optionsJSON: options });
      return post('/auth/login', { response: credential, visitorId });
    },
  });
}
