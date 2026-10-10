import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Breadcrumbs } from '../components/Layout';
import { Empty, ErrorMessage, Pagination, Price, Skeleton, useToast } from '../components/ui';
import { api } from '../lib/api';
import type { Order, Paged } from '../lib/types';

const LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PAID: 'Paid',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};
const TONE: Record<string, string> = {
  PENDING_PAYMENT: 'bg-amber-100 text-amber-900',
  PAID: 'bg-blue-100 text-blue-900',
  PROCESSING: 'bg-blue-100 text-blue-900',
  SHIPPED: 'bg-indigo-100 text-indigo-900',
  DELIVERED: 'bg-green-100 text-green-900',
  CANCELLED: 'bg-slate-200 text-slate-800',
  REFUNDED: 'bg-slate-200 text-slate-800',
};
export const StatusBadge = ({ status }: { status: string }) => (
  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[status] ?? ''}`}>
    {LABEL[status] ?? status}
  </span>
);

export function OrdersList() {
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') ?? 1) || 1;
  const q = useQuery({
    queryKey: ['orders', page],
    queryFn: () => api<Paged<Order>>(`/orders?page=${page}`),
  });
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError) return <ErrorMessage error={q.error} />;
  if (q.data!.items.length === 0)
    return (
      <Empty title="No orders yet">
        <Link to="/products" className="btn-primary mt-3">
          Start shopping
        </Link>
      </Empty>
    );
  return (
    <section aria-labelledby="orders-h">
      <h1 id="orders-h" className="mb-3 text-2xl font-bold">
        Your orders
      </h1>
      <ul className="space-y-3">
        {q.data!.items.map((o) => (
          <li key={o.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm text-slate-500">
                  Placed {new Date(o.createdAt).toLocaleDateString()} · #{o.id.slice(0, 8)}
                </p>
                <p className="font-semibold">
                  <Price paise={o.totalMinor} />
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={o.status} />
                <Link className="btn-ghost" to={`/orders/${o.id}`}>
                  View details
                </Link>
              </div>
            </div>
            <p className="mt-2 truncate text-sm text-slate-600">
              {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
            </p>
          </li>
        ))}
      </ul>
      <Pagination
        page={q.data!.page}
        totalPages={Math.max(1, Math.ceil(q.data!.total / q.data!.pageSize))}
        onPage={(p) => setSp({ page: String(p) })}
      />
    </section>
  );
}

export function OrderDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const notify = useToast();
  const q = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<{ order: Order }>(`/orders/${id}`),
  });
  const done = (d: { order: Order }) => {
    qc.setQueryData(['order', id], d);
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };
  const pay = useMutation({
    mutationFn: (outcome: 'success' | 'failure') =>
      api<{ order: Order }>(`/orders/${id}/pay/mock`, { method: 'POST', body: { outcome } }),
    onSuccess: (d) => {
      done(d);
      notify('Mock payment processed');
    },
    onError: (e: Error) => notify(e.message, 'error'),
  });
  const cancel = useMutation({
    mutationFn: () => api<{ order: Order }>(`/orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: (d) => {
      done(d);
      notify('Order cancelled');
    },
    onError: (e: Error) => notify(e.message, 'error'),
  });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError)
    return (
      <Empty title="Order not found">
        <Link className="text-brand-700 underline" to="/orders">
          Back to orders
        </Link>
      </Empty>
    );
  const o = q.data!.order;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/' },
          { label: 'Orders', to: '/orders' },
          { label: `#${o.id.slice(0, 8)}` },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Order #{o.id.slice(0, 8)}</h1>
        <StatusBadge status={o.status} />
      </div>
      {o.status === 'PENDING_PAYMENT' && (
        <section className="card mb-6 border-amber-300 bg-amber-50 p-4" aria-labelledby="pay-h">
          <h2 id="pay-h" className="font-semibold">
            Complete payment{' '}
            <span className="ml-2 rounded bg-amber-200 px-2 py-0.5 text-xs">
              MOCK PAYMENT - no real money
            </span>
          </h2>
          <p className="mt-1 text-sm">
            Amount due: <Price paise={o.totalMinor} className="font-bold" />. This simulates a
            payment provider by sending a signed webhook to the server; your order is only marked
            paid after the server verifies it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn-primary"
              disabled={pay.isPending}
              onClick={() => pay.mutate('success')}
            >
              Simulate successful payment
            </button>
            <button
              className="btn-ghost"
              disabled={pay.isPending}
              onClick={() => pay.mutate('failure')}
            >
              Simulate failed payment
            </button>
            <button
              className="btn-danger"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              Cancel order
            </button>
          </div>
        </section>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="card p-4" aria-labelledby="track-h">
            <h2 id="track-h" className="mb-3 font-semibold">
              Tracking
            </h2>
            <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
              {o.tracking.map((t, i) => (
                <li key={i} className="relative">
                  <span
                    className="absolute -left-[22px] top-1 h-3 w-3 rounded-full bg-brand-600"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-medium">
                    <StatusBadge status={t.status} />{' '}
                    <span className="ml-1 text-slate-500">{new Date(t.at).toLocaleString()}</span>
                  </p>
                  {t.note && <p className="text-sm text-slate-600">{t.note}</p>}
                </li>
              ))}
            </ol>
          </section>
          <section className="card p-4" aria-labelledby="items-h">
            <h2 id="items-h" className="mb-3 font-semibold">
              Items
            </h2>
            <ul className="divide-y">
              {o.items.map((i) => (
                <li key={i.productId} className="flex justify-between gap-3 py-2 text-sm">
                  <span>
                    {i.quantity} × {i.name}
                    <span className="block text-xs text-slate-500">SKU {i.sku}</span>
                  </span>
                  <Price paise={i.lineTotalMinor} />
                </li>
              ))}
            </ul>
            {o.status === 'DELIVERED' && (
              <p className="mt-3 text-sm text-slate-600">
                Delivered?{' '}
                <Link className="text-brand-700 underline" to="/products">
                  Visit the product page
                </Link>{' '}
                to leave a review.
              </p>
            )}
          </section>
        </div>
        <aside className="space-y-4">
          <section className="card p-4">
            <h2 className="mb-2 font-semibold">Summary</h2>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd>
                  <Price paise={o.subtotalMinor} />
                </dd>
              </div>
              {o.discountMinor > 0 && (
                <div className="flex justify-between text-green-700">
                  <dt>Discount {o.couponCode && `(${o.couponCode})`}</dt>
                  <dd>
                    −<Price paise={o.discountMinor} />
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt>GST</dt>
                <dd>
                  <Price paise={o.taxMinor} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Shipping</dt>
                <dd>{o.shippingMinor === 0 ? 'FREE' : <Price paise={o.shippingMinor} />}</dd>
              </div>
              <div className="flex justify-between border-t pt-2 font-bold">
                <dt>Total</dt>
                <dd>
                  <Price paise={o.totalMinor} />
                </dd>
              </div>
            </dl>
            {o.payment && (
              <p className="mt-2 text-xs text-slate-500">
                Payment: {o.payment.status}
                {o.payment.isMock ? ' (mock provider)' : ''}
              </p>
            )}
          </section>
          <section className="card p-4 text-sm">
            <h2 className="mb-2 font-semibold">Ship to</h2>
            <p>
              {o.shippingAddress.name}
              <br />
              {o.shippingAddress.line1}
              {o.shippingAddress.line2 ? `, ${o.shippingAddress.line2}` : ''}
              <br />
              {o.shippingAddress.city}, {o.shippingAddress.state} {o.shippingAddress.postalCode}
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
