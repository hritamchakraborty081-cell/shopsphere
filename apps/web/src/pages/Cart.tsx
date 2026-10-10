import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Empty, ErrorMessage, Price, Skeleton, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useCart } from '../lib/hooks';

export default function CartPage() {
  const cart = useCart();
  const qc = useQueryClient();
  const notify = useToast();
  const refresh = () => qc.invalidateQueries({ queryKey: ['cart'] });
  const setQty = useMutation({
    mutationFn: (v: { id: string; quantity: number }) =>
      api(`/cart/items/${v.id}`, { method: 'PATCH', body: { quantity: v.quantity } }),
    onSuccess: refresh,
    onError: (e: Error) => {
      notify(e.message, 'error');
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/cart/items/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  if (cart.isLoading) return <Skeleton className="h-64" />;
  if (cart.isError) return <ErrorMessage error={cart.error} />;
  const c = cart.data!;
  if (c.items.length === 0)
    return (
      <Empty title="Your cart is empty">
        <Link to="/products" className="btn-primary mt-3">
          Continue shopping
        </Link>
      </Empty>
    );
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section aria-labelledby="cart-h">
        <h1 id="cart-h" className="mb-3 text-2xl font-bold">
          Shopping cart
        </h1>
        <ul className="space-y-3">
          {c.items.map((l) => (
            <li key={l.productId} className="card flex gap-4 p-3">
              {l.image && (
                <img src={l.image} alt="" className="h-24 w-24 rounded-lg object-cover" />
              )}
              <div className="flex-1">
                <Link to={`/products/${l.slug}`} className="font-medium hover:text-brand-700">
                  {l.name}
                </Link>
                <p>
                  <Price paise={l.unitPriceMinor} className="font-semibold" />
                </p>
                {l.issue && (
                  <p role="alert" className="text-sm font-semibold text-red-700">
                    {l.issue === 'OUT_OF_STOCK'
                      ? 'Out of stock - remove to continue'
                      : `Only ${l.available} available - reduce quantity`}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-3">
                  <label className="text-sm">
                    Qty{' '}
                    <select
                      className="input ml-1 w-20"
                      value={l.quantity}
                      onChange={(e) =>
                        setQty.mutate({ id: l.productId, quantity: Number(e.target.value) })
                      }
                    >
                      {Array.from({ length: 10 }, (_, i) => (
                        <option key={i + 1}>{i + 1}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="inline-flex items-center gap-1 text-sm text-red-700 hover:underline"
                    onClick={() => remove.mutate(l.productId)}
                  >
                    <Trash2 size={14} />
                    Remove
                  </button>
                </div>
              </div>
              <Price paise={l.lineTotalMinor} className="font-bold" />
            </li>
          ))}
        </ul>
      </section>
      <aside className="card h-fit p-4">
        <h2 className="font-semibold">Order summary</h2>
        <p className="mt-2 flex justify-between">
          <span>Subtotal ({c.itemCount} items)</span>
          <Price paise={c.subtotalMinor} className="font-bold" />
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Tax, shipping and coupons are calculated at checkout.
        </p>
        {c.hasIssues ? (
          <p className="mt-3 text-sm text-red-700">Fix the highlighted items to continue.</p>
        ) : (
          <Link to="/checkout" className="btn-primary mt-4 w-full">
            Proceed to checkout
          </Link>
        )}
      </aside>
    </div>
  );
}
