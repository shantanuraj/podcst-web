import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

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
