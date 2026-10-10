import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { api, setCsrfToken } from './api';
import type { User } from './types';

interface Me {
  user: User | null;
  csrfToken: string | null;
}
interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const d = await api<Me>('/auth/me');
      setCsrfToken(d.csrfToken);
      return d;
    },
    staleTime: 5 * 60_000,
  });
  const loginM = useMutation({
    mutationFn: (v: { email: string; password: string }) =>
      api<Me & { user: User }>('/auth/login', { method: 'POST', body: v }),
    onSuccess: (d) => {
      setCsrfToken(d.csrfToken);
      qc.setQueryData(['me'], d);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
  });
  const logoutM = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      setCsrfToken(null);
      qc.clear();
      qc.setQueryData(['me'], { user: null, csrfToken: null });
    },
  });
  return (
    <Ctx.Provider
      value={{
        user: me.data?.user ?? null,
        loading: me.isLoading,
        login: async (email, password) => (await loginM.mutateAsync({ email, password })).user,
        logout: async () => {
          await logoutM.mutateAsync().catch(() => undefined);
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside AuthProvider');
  return c;
}
