import { Star } from 'lucide-react';
import {
  Component,
  createContext,
  useCallback,
  useContext,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { formatPaise } from '@shopsphere/shared';
import { ApiError } from '../lib/api';

export const Price = ({ paise, className = '' }: { paise: number; className?: string }) => (
  <span className={className}>{formatPaise(paise)}</span>
);

export function Stars({ value, count }: { value: number; count?: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-sm"
      aria-label={`Rated ${value} out of 5${count !== undefined ? ` from ${count} reviews` : ''}`}
    >
      <span className="inline-flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            size={14}
            className={i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}
          />
        ))}
      </span>
      {count !== undefined && <span className="text-slate-500">({count})</span>}
    </span>
  );
}

export const Skeleton = ({ className = '' }: { className?: string }) => (
  <div aria-hidden="true" className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />
);

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="card p-10 text-center">
    <h2 className="text-lg font-semibold">{title}</h2>
    <div className="mt-2 text-slate-600">{children}</div>
  </div>
);

export const ErrorMessage = ({ error }: { error: unknown }) => (
  <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
    {error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong'}
  </p>
);

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <div className="mt-1 font-normal">{children}</div>
      {error && (
        <span role="alert" className="mt-1 block text-xs text-red-700">
          {error}
        </span>
      )}
    </label>
  );
}

export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-3">
      <button className="btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="text-sm">
        Page {page} of {totalPages}
      </span>
      <button className="btn-ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

/* ---- toasts: announced to screen readers via aria-live ---- */
type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const notify = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-2 text-sm shadow-lg ${t.kind === 'ok' ? 'bg-slate-900 text-white' : 'bg-red-700 text-white'}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('UI error', err.message, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-lg p-10 text-center">
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-slate-600">Please reload the page.</p>
        <button className="btn-dark mt-4" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
