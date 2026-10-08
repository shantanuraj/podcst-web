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
    onMutate: async () => {
      await session.checkpointAndSuspend();
      session.beginAuthChange();
    },
    onSuccess: () => session.finishAuthChange(true),
    onError: () => session.finishAuthChange(false),
  };
}

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
    mutationFn: async (_email: string) => {
      const { options, flowId } = await post<{
        options: PublicKeyCredentialCreationOptionsJSON;
        flowId: string;
      }>('/auth/register', {});
      const credential = await startRegistration({ optionsJSON: options });
      return post('/auth/register', { response: credential, flowId });
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
      const { options, flowId } = await post<{
        options: PublicKeyCredentialRequestOptionsJSON;
        flowId: string;
      }>('/auth/login', { discoverable: true });
      const credential = await startAuthentication({ optionsJSON: options });
      return post('/auth/login', { response: credential, flowId });
    },
  });
}
