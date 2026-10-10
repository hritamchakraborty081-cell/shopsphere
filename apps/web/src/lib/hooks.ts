import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import type { Cart, ProductCardData } from './types';
import { useToast } from '../components/ui';

export function useCart() {
  const { user } = useAuth();
  return useQuery({ queryKey: ['cart'], queryFn: () => api<Cart>('/cart'), enabled: !!user });
}

export function useWishlist() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const notify = useToast();
  const q = useQuery({
    queryKey: ['wishlist'],
    queryFn: () => api<{ items: ProductCardData[] }>('/wishlist'),
    enabled: !!user,
  });
  const m = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      api(`/wishlist/${id}`, { method: on ? 'PUT' : 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
    onError: (e: Error) => notify(e.message, 'error'),
  });
  const ids = new Set((q.data?.items ?? []).map((i) => i.id));
  return {
    items: q.data?.items ?? [],
    isLoading: q.isLoading,
    has: (id: string) => ids.has(id),
    toggle: (id: string) => {
      if (!user) return nav('/login', { state: { from: loc.pathname + loc.search } });
      m.mutate({ id, on: !ids.has(id) });
    },
  };
}
