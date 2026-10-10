import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Empty, ErrorMessage, Field, Price, Skeleton, useToast } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCart } from '../lib/hooks';
import type { Address, Order } from '../lib/types';

export const addressForm = z.object({
  fullName: z.string().trim().min(1, 'Required').max(80),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{7,15}$/, 'Enter a valid phone number'),
  line1: z.string().trim().min(3, 'Required').max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2, 'Required'),
  state: z.string().trim().min(2, 'Required'),
  postalCode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, 'Enter a 6-digit PIN code'),
});

export function AddressForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.infer<typeof addressForm>>({ resolver: zodResolver(addressForm) });
  const m = useMutation({
    mutationFn: (v: z.infer<typeof addressForm>) =>
      api('/users/me/addresses', { method: 'POST', body: { ...v, line2: v.line2 || null } }),
    onSuccess: () => {
      reset();
      void qc.invalidateQueries({ queryKey: ['addresses'] });
      onDone();
    },
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      noValidate
      onSubmit={handleSubmit((v) => m.mutate(v))}
    >
      {m.isError && (
        <div className="sm:col-span-2">
          <ErrorMessage error={m.error} />
        </div>
      )}
      <Field label="Full name" error={errors.fullName?.message}>
        <input className="input" autoComplete="name" {...register('fullName')} />
      </Field>
      <Field label="Phone" error={errors.phone?.message}>
        <input className="input" autoComplete="tel" {...register('phone')} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Address line 1" error={errors.line1?.message}>
          <input className="input" autoComplete="address-line1" {...register('line1')} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Address line 2 (optional)">
          <input className="input" autoComplete="address-line2" {...register('line2')} />
        </Field>
      </div>
      <Field label="City" error={errors.city?.message}>
        <input className="input" autoComplete="address-level2" {...register('city')} />
      </Field>
      <Field label="State" error={errors.state?.message}>
        <input className="input" autoComplete="address-level1" {...register('state')} />
      </Field>
      <Field label="PIN code" error={errors.postalCode?.message}>
        <input
          className="input"
          inputMode="numeric"
          autoComplete="postal-code"
          {...register('postalCode')}
        />
      </Field>
      <div className="flex items-end">
        <button className="btn-dark" disabled={m.isPending}>
          Save address
        </button>
      </div>
    </form>
  );
}

export default function Checkout() {
  const { user } = useAuth();
  const cart = useCart();
  const nav = useNavigate();
  const qc = useQueryClient();
  const notify = useToast();
  const addrs = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api<{ items: Address[] }>('/users/me/addresses'),
  });
  const [addressId, setAddressId] = useState('');
  const [method, setMethod] = useState<'STANDARD' | 'EXPRESS'>('STANDARD');
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);
  // One Idempotency-Key per checkout attempt: a double click or retry can never create two orders.
  const idemKey = useRef(crypto.randomUUID());
  const quote = useQuery({
    queryKey: ['quote', method, coupon, cart.data?.subtotalMinor],
    queryFn: () =>
      api<{
        subtotalMinor: number;
        discountMinor: number;
        taxMinor: number;
        shippingMinor: number;
        totalMinor: number;
      }>('/checkout/quote', {
        method: 'POST',
        body: { shippingMethod: method, couponCode: coupon },
      }),
    enabled: !!cart.data && cart.data.items.length > 0,
    retry: false,
  });
  const place = useMutation({
    mutationFn: () =>
      api<{ order: Order }>('/orders', {
        method: 'POST',
        body: {
          addressId: addressId || addrs.data?.items[0]?.id,
          shippingMethod: method,
          couponCode: coupon,
        },
        headers: { 'Idempotency-Key': idemKey.current },
      }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['cart'] });
      nav(`/orders/${d.order.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') {
        void qc.invalidateQueries({ queryKey: ['cart'] });
        idemKey.current = crypto.randomUUID();
      }
    },
  });
  if (cart.isLoading || addrs.isLoading) return <Skeleton className="h-64" />;
  if (!cart.data || cart.data.items.length === 0)
    return (
      <Empty title="Your cart is empty">
        <Link to="/products" className="btn-primary mt-3">
          Continue shopping
        </Link>
      </Empty>
    );
  const list = addrs.data?.items ?? [];
  const selected = addressId || list[0]?.id || '';
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Checkout</h1>
        {!user?.emailVerified && (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Verify your email address before placing an order (check your inbox for the link).
          </p>
        )}
        <section className="card p-4" aria-labelledby="ship-h">
          <h2 id="ship-h" className="mb-3 font-semibold">
            1. Shipping address
          </h2>
          {list.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="sr-only">Choose an address</legend>
              {list.map((a) => (
                <label
                  key={a.id}
                  className="flex cursor-pointer gap-3 rounded-lg border p-3 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
                >
                  <input
                    type="radio"
                    name="address"
                    checked={selected === a.id}
                    onChange={() => setAddressId(a.id)}
                  />
                  <span className="text-sm">
                    <strong>{a.fullName}</strong> · {a.phone}
                    <br />
                    {a.line1}
                    {a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} {a.postalCode}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {adding || list.length === 0 ? (
            <div className="mt-3">
              <AddressForm onDone={() => setAdding(false)} />
            </div>
          ) : (
            <button className="btn-ghost mt-3" onClick={() => setAdding(true)}>
              Add a new address
            </button>
          )}
        </section>
        <section className="card p-4" aria-labelledby="del-h">
          <h2 id="del-h" className="mb-3 font-semibold">
            2. Delivery
          </h2>
          <fieldset className="space-y-2">
            <legend className="sr-only">Delivery speed</legend>
            {(
              [
                ['STANDARD', 'Standard delivery (3-5 days)', 'Free above ₹500, otherwise ₹40'],
                ['EXPRESS', 'Express delivery (1-2 days)', '₹120'],
              ] as const
            ).map(([v, t, s]) => (
              <label
                key={v}
                className="flex cursor-pointer gap-3 rounded-lg border p-3 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
              >
                <input
                  type="radio"
                  name="method"
                  checked={method === v}
                  onChange={() => setMethod(v)}
                />
                <span className="text-sm">
                  <strong>{t}</strong>
                  <br />
                  <span className="text-slate-500">{s}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </section>
        <section className="card p-4" aria-labelledby="pay-h">
          <h2 id="pay-h" className="mb-2 font-semibold">
            3. Payment
          </h2>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <strong>Mock payment mode.</strong> After placing the order you can simulate a payment.
            No real money, card or bank details are involved.
          </p>
        </section>
      </div>
      <aside className="card h-fit space-y-3 p-4">
        <h2 className="font-semibold">Order summary</h2>
        <ul className="space-y-1 text-sm">
          {cart.data.items.map((l) => (
            <li key={l.productId} className="flex justify-between gap-2">
              <span className="truncate">
                {l.quantity} × {l.name}
              </span>
              <Price paise={l.lineTotalMinor} />
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setCoupon(couponInput.trim().toUpperCase() || undefined);
          }}
        >
          <input
            aria-label="Coupon code"
            className="input"
            placeholder="Coupon code"
            value={couponInput}
            maxLength={32}
            onChange={(e) => setCouponInput(e.target.value)}
          />
          <button className="btn-ghost">Apply</button>
        </form>
        {quote.isError && <ErrorMessage error={quote.error} />}
        {quote.data && (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>
                <Price paise={quote.data.subtotalMinor} />
              </dd>
            </div>
            {quote.data.discountMinor > 0 && (
              <div className="flex justify-between text-green-700">
                <dt>Discount</dt>
                <dd>
                  −<Price paise={quote.data.discountMinor} />
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>GST (18%)</dt>
              <dd>
                <Price paise={quote.data.taxMinor} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Shipping</dt>
              <dd>
                {quote.data.shippingMinor === 0 ? (
                  'FREE'
                ) : (
                  <Price paise={quote.data.shippingMinor} />
                )}
              </dd>
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-bold">
              <dt>Total</dt>
              <dd>
                <Price paise={quote.data.totalMinor} />
              </dd>
            </div>
          </dl>
        )}
        {place.isError && <ErrorMessage error={place.error} />}
        <button
          className="btn-primary w-full"
          disabled={place.isPending || !selected || !quote.data || !user?.emailVerified}
          onClick={() => place.mutate(undefined, { onError: (e) => notify(e.message, 'error') })}
        >
          Place order
        </button>
        <p className="text-xs text-slate-500">
          The final amount is always calculated by our server.
        </p>
      </aside>
    </div>
  );
}
