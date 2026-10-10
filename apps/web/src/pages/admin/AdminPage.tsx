import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ORDER_TRANSITIONS, type OrderStatus } from '@shopsphere/shared';
import {
  Empty,
  ErrorMessage,
  Field,
  Pagination,
  Price,
  Skeleton,
  useToast,
} from '../../components/ui';
import { StatusBadge } from '../Orders';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Category, Order, Paged } from '../../lib/types';

const TABS = ['Dashboard', 'Products', 'Orders', 'Users', 'Categories', 'Audit log'] as const;
type Tab = (typeof TABS)[number];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('Dashboard');
  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">Admin</h1>
      <div role="tablist" aria-label="Admin sections" className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'btn-dark' : 'btn-ghost'}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'Dashboard' && <Dashboard />}
        {tab === 'Products' && <ProductsAdmin />}
        {tab === 'Orders' && <OrdersAdmin />}
        {tab === 'Users' && <UsersAdmin />}
        {tab === 'Categories' && <CategoriesAdmin />}
        {tab === 'Audit log' && <AuditAdmin />}
      </div>
    </div>
  );
}

function Dashboard() {
  const q = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () =>
      api<{
        users: number;
        orders: number;
        revenueMinor: number;
        lowStockProducts: number;
        ordersByStatus: Record<string, number>;
      }>('/admin/stats'),
  });
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (q.isError) return <ErrorMessage error={q.error} />;
  const s = q.data!;
  const Stat = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="card p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-bold">{children}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Stat label="Revenue (paid orders)">
        <Price paise={s.revenueMinor} />
      </Stat>
      <Stat label="Orders">{s.orders}</Stat>
      <Stat label="Customers & admins">{s.users}</Stat>
      <Stat label="Low-stock products">{s.lowStockProducts}</Stat>
    </div>
  );
}

interface AdminProduct {
  id: string;
  sku: string;
  name: string;
  brand: string;
  description: string;
  priceMinor: number;
  mrpMinor: number;
  isActive: boolean;
  stock: number;
  category: { id: string; name: string };
}
function ProductsAdmin() {
  const qc = useQueryClient();
  const notify = useToast();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['admin', 'products', page, q],
    queryFn: () =>
      api<Paged<AdminProduct>>(
        `/admin/products?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
  });
  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ items: Category[] }>('/categories'),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'products'] });
  const err = (e: Error) => notify(e.message, 'error');
  const stock = useMutation({
    mutationFn: (v: { id: string; quantity: number }) =>
      api(`/admin/products/${v.id}/inventory`, { method: 'PATCH', body: { quantity: v.quantity } }),
    onSuccess: () => {
      notify('Stock updated');
      void refresh();
    },
    onError: err,
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/admin/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      notify('Product deleted');
      void refresh();
    },
    onError: err,
  });
  const price = useMutation({
    mutationFn: (v: { id: string; priceMinor: number }) =>
      api(`/admin/products/${v.id}`, { method: 'PATCH', body: { priceMinor: v.priceMinor } }),
    onSuccess: () => {
      notify('Price updated');
      void refresh();
    },
    onError: err,
  });
  const { register, handleSubmit, reset } = useForm<{
    sku: string;
    name: string;
    brand: string;
    description: string;
    price: number;
    mrp: number;
    categoryId: string;
    stock: number;
    imageUrl: string;
  }>();
  const create = useMutation({
    mutationFn: (v: {
      sku: string;
      name: string;
      brand: string;
      description: string;
      price: number;
      mrp: number;
      categoryId: string;
      stock: number;
      imageUrl: string;
    }) =>
      api('/admin/products', {
        method: 'POST',
        body: {
          sku: v.sku,
          name: v.name,
          brand: v.brand,
          description: v.description,
          categoryId: v.categoryId,
          priceMinor: Math.round(Number(v.price) * 100),
          mrpMinor: Math.round(Number(v.mrp) * 100),
          stock: Number(v.stock),
          images: v.imageUrl ? [{ url: v.imageUrl, alt: v.name }] : [],
        },
      }),
    onSuccess: () => {
      notify('Product created');
      reset();
      void refresh();
    },
    onError: err,
  });
  return (
    <div className="space-y-6">
      <details className="card p-4">
        <summary className="cursor-pointer font-semibold">Add a product</summary>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={handleSubmit((v) => create.mutate(v))}
        >
          {create.isError && (
            <div className="sm:col-span-2">
              <ErrorMessage error={create.error} />
            </div>
          )}
          <Field label="SKU (A-Z, 0-9, -)">
            <input className="input" required {...register('sku')} />
          </Field>
          <Field label="Name">
            <input className="input" required {...register('name')} />
          </Field>
          <Field label="Brand">
            <input className="input" required {...register('brand')} />
          </Field>
          <Field label="Category">
            <select className="input" required {...register('categoryId')}>
              {cats.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Price (₹)">
            <input
              className="input"
              type="number"
              step="0.01"
              min="1"
              required
              {...register('price')}
            />
          </Field>
          <Field label="MRP (₹)">
            <input
              className="input"
              type="number"
              step="0.01"
              min="1"
              required
              {...register('mrp')}
            />
          </Field>
          <Field label="Stock">
            <input className="input" type="number" min="0" required {...register('stock')} />
          </Field>
          <Field label="Image URL (https:// or /products/…)">
            <input className="input" {...register('imageUrl')} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">
              <textarea rows={3} className="input" required {...register('description')} />
            </Field>
          </div>
          <div>
            <button className="btn-dark" disabled={create.isPending}>
              Create product
            </button>
          </div>
        </form>
      </details>
      <div>
        <input
          aria-label="Search admin products"
          className="input mb-3 max-w-xs"
          placeholder="Search name or SKU"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        {list.isLoading ? (
          <Skeleton className="h-48" />
        ) : list.isError ? (
          <ErrorMessage error={list.error} />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Products</caption>
              <thead className="bg-slate-100 text-xs uppercase">
                <tr>
                  <th className="p-2">SKU</th>
                  <th>Name</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data!.items.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2 font-mono text-xs">{p.sku}</td>
                    <td>{p.name}</td>
                    <td>
                      <button
                        className="underline"
                        onClick={() => {
                          const v = prompt(
                            `New price in ₹ for ${p.name}`,
                            String(p.priceMinor / 100),
                          );
                          if (v && Number(v) > 0)
                            price.mutate({ id: p.id, priceMinor: Math.round(Number(v) * 100) });
                        }}
                      >
                        <Price paise={p.priceMinor} />
                      </button>
                    </td>
                    <td>
                      <button
                        className={`underline ${p.stock <= 5 ? 'font-bold text-red-700' : ''}`}
                        onClick={() => {
                          const v = prompt(`Set stock for ${p.name}`, String(p.stock));
                          if (v !== null && Number.isInteger(Number(v)) && Number(v) >= 0)
                            stock.mutate({ id: p.id, quantity: Number(v) });
                        }}
                      >
                        {p.stock}
                      </button>
                    </td>
                    <td>
                      <button
                        className="text-red-700 underline"
                        onClick={() => confirm(`Delete ${p.name}?`) && del.mutate(p.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && (
          <Pagination
            page={page}
            totalPages={Math.max(1, Math.ceil(list.data.total / list.data.pageSize))}
            onPage={setPage}
          />
        )}
      </div>
    </div>
  );
}

function OrdersAdmin() {
  const qc = useQueryClient();
  const notify = useToast();
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['admin', 'orders', page],
    queryFn: () => api<Paged<Order>>(`/admin/orders?page=${page}`),
  });
  const m = useMutation({
    mutationFn: (v: { id: string; status: string }) =>
      api(`/admin/orders/${v.id}/status`, { method: 'PATCH', body: { status: v.status } }),
    onSuccess: () => {
      notify('Order updated');
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e: Error) => notify(e.message, 'error'),
  });
  if (list.isLoading) return <Skeleton className="h-48" />;
  if (list.isError) return <ErrorMessage error={list.error} />;
  if (list.data!.items.length === 0) return <Empty title="No orders yet" />;
  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Orders</caption>
          <thead className="bg-slate-100 text-xs uppercase">
            <tr>
              <th className="p-2">Order</th>
              <th>Customer</th>
              <th>Total</th>
              <th>Status</th>
              <th>Change status</th>
            </tr>
          </thead>
          <tbody>
            {list.data!.items.map((o) => {
              const next = ORDER_TRANSITIONS[o.status as OrderStatus] ?? [];
              return (
                <tr key={o.id} className="border-t">
                  <td className="p-2 font-mono text-xs">#{o.id.slice(0, 8)}</td>
                  <td>{o.customer?.email}</td>
                  <td>
                    <Price paise={o.totalMinor} />
                  </td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>
                    {next.length === 0 ? (
                      <span className="text-slate-400">-</span>
                    ) : (
                      <select
                        aria-label={`Change status of order ${o.id.slice(0, 8)}`}
                        className="input w-auto"
                        value=""
                        onChange={(e) =>
                          e.target.value && m.mutate({ id: o.id, status: e.target.value })
                        }
                      >
                        <option value="">Select…</option>
                        {next.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        totalPages={Math.max(1, Math.ceil(list.data!.total / list.data!.pageSize))}
        onPage={setPage}
      />
    </>
  );
}

function UsersAdmin() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const notify = useToast();
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['admin', 'users', page],
    queryFn: () =>
      api<Paged<{ id: string; email: string; name: string; role: string; emailVerified: boolean }>>(
        `/admin/users?page=${page}`,
      ),
  });
  const m = useMutation({
    mutationFn: (v: { id: string; role: string }) =>
      api(`/admin/users/${v.id}/role`, { method: 'PATCH', body: { role: v.role } }),
    onSuccess: () => {
      notify('Role updated (user must sign in again)');
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (e: Error) => notify(e.message, 'error'),
  });
  if (list.isLoading) return <Skeleton className="h-48" />;
  if (list.isError) return <ErrorMessage error={list.error} />;
  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Users</caption>
          <thead className="bg-slate-100 text-xs uppercase">
            <tr>
              <th className="p-2">Name</th>
              <th>Email</th>
              <th>Verified</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {list.data!.items.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-2">{u.name}</td>
                <td>{u.email}</td>
                <td>{u.emailVerified ? 'Yes' : 'No'}</td>
                <td>
                  <select
                    aria-label={`Role for ${u.email}`}
                    className="input w-auto"
                    disabled={u.id === me?.id}
                    value={u.role}
                    onChange={(e) => m.mutate({ id: u.id, role: e.target.value })}
                  >
                    <option>CUSTOMER</option>
                    <option>ADMIN</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        totalPages={Math.max(1, Math.ceil(list.data!.total / list.data!.pageSize))}
        onPage={setPage}
      />
    </>
  );
}

function CategoriesAdmin() {
  const qc = useQueryClient();
  const notify = useToast();
  const list = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ items: Category[] }>('/categories'),
  });
  const { register, handleSubmit, reset } = useForm<{ name: string }>();
  const refresh = () => qc.invalidateQueries({ queryKey: ['categories'] });
  const add = useMutation({
    mutationFn: (v: { name: string }) => api('/admin/categories', { method: 'POST', body: v }),
    onSuccess: () => {
      reset();
      void refresh();
    },
    onError: (e: Error) => notify(e.message, 'error'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/admin/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => void refresh(),
    onError: (e: Error) => notify(e.message, 'error'),
  });
  return (
    <div className="max-w-lg space-y-4">
      <form className="flex items-end gap-3" onSubmit={handleSubmit((v) => add.mutate(v))}>
        <div className="flex-1">
          <Field label="New category">
            <input className="input" required minLength={2} {...register('name')} />
          </Field>
        </div>
        <button className="btn-dark">Add</button>
      </form>
      <ul className="card divide-y">
        {list.data?.items.map((c) => (
          <li key={c.id} className="flex items-center justify-between p-3 text-sm">
            <span>
              {c.name} <span className="text-slate-500">({c.productCount})</span>
            </span>
            <button className="text-red-700 underline" onClick={() => del.mutate(c.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuditAdmin() {
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['admin', 'audit', page],
    queryFn: () =>
      api<
        Paged<{
          id: string;
          action: string;
          entity: string;
          entityId: string | null;
          actor: string | null;
          createdAt: string;
        }>
      >(`/admin/audit-logs?page=${page}`),
  });
  if (list.isLoading) return <Skeleton className="h-48" />;
  if (list.isError) return <ErrorMessage error={list.error} />;
  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Audit log</caption>
          <thead className="bg-slate-100 text-xs uppercase">
            <tr>
              <th className="p-2">Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
            </tr>
          </thead>
          <tbody>
            {list.data!.items.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2 whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                <td>{l.actor ?? 'system'}</td>
                <td className="font-mono text-xs">{l.action}</td>
                <td>
                  {l.entity} {l.entityId?.slice(0, 8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        totalPages={Math.max(1, Math.ceil(list.data!.total / list.data!.pageSize))}
        onPage={setPage}
      />
    </>
  );
}
