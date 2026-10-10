import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { Breadcrumbs } from '../components/Layout';
import { ProductCard } from '../components/ProductCard';
import { Empty, ErrorMessage, Field, Price, Skeleton, Stars, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useWishlist } from '../lib/hooks';
import type { Paged, ProductCardData } from '../lib/types';

interface Detail extends ProductCardData {
  sku: string;
  description: string;
  category: { name: string; slug: string };
  images: { url: string; alt: string }[];
  maxQuantity: number;
  distribution: Record<string, number>;
  related: ProductCardData[];
}
interface Review {
  id: string;
  rating: number;
  title: string;
  body: string;
  author: string;
  createdAt: string;
}
const reviewForm = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().min(2, 'Add a short title').max(100),
  body: z.string().trim().min(5, 'Tell us a bit more').max(2000),
});

function Reviews({ productId }: { productId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const notify = useToast();
  const list = useQuery({
    queryKey: ['reviews', productId],
    queryFn: () => api<Paged<Review>>(`/products/${productId}/reviews`),
  });
  const elig = useQuery({
    queryKey: ['review-elig', productId],
    queryFn: () =>
      api<{ eligible: boolean; reason: string | null }>(
        `/products/${productId}/review-eligibility`,
      ),
    enabled: !!user,
  });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.input<typeof reviewForm>, unknown, z.output<typeof reviewForm>>({
    resolver: zodResolver(reviewForm),
    defaultValues: { rating: 5 },
  });
  const m = useMutation({
    mutationFn: (v: z.output<typeof reviewForm>) =>
      api(`/products/${productId}/reviews`, { method: 'POST', body: v }),
    onSuccess: () => {
      notify('Thanks for your review!');
      reset();
      void qc.invalidateQueries({ queryKey: ['reviews', productId] });
      void qc.invalidateQueries({ queryKey: ['review-elig', productId] });
      void qc.invalidateQueries({ queryKey: ['product'] });
    },
    onError: (e: Error) => notify(e.message, 'error'),
  });
  return (
    <section className="mt-10" aria-labelledby="reviews-h">
      <h2 id="reviews-h" className="text-xl font-bold">
        Customer reviews
      </h2>
      {list.data?.items.length === 0 && <p className="mt-2 text-slate-600">No reviews yet.</p>}
      <ul className="mt-3 space-y-4">
        {list.data?.items.map((r) => (
          <li key={r.id} className="card p-4">
            <div className="flex items-center gap-2">
              <Stars value={r.rating} />
              <strong>{r.title}</strong>
            </div>
            {/* React escapes text content: stored markup is displayed inertly. */}
            <p className="mt-1 whitespace-pre-line text-sm">{r.body}</p>
            <p className="mt-1 text-xs text-slate-500">
              {r.author} · {new Date(r.createdAt).toLocaleDateString()}
            </p>
          </li>
        ))}
      </ul>
      {user && elig.data?.eligible && (
        <form
          className="card mt-6 max-w-lg space-y-3 p-4"
          onSubmit={handleSubmit((v) => m.mutate(v))}
          noValidate
        >
          <h3 className="font-semibold">Write a review</h3>
          <Field label="Rating">
            <select className="input" {...register('rating')}>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} star{n > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title" error={errors.title?.message}>
            <input className="input" {...register('title')} />
          </Field>
          <Field label="Review" error={errors.body?.message}>
            <textarea rows={3} className="input" {...register('body')} />
          </Field>
          <button className="btn-dark" disabled={m.isPending}>
            Submit review
          </button>
        </form>
      )}
      {user && elig.data && !elig.data.eligible && (
        <p className="mt-4 text-sm text-slate-500">
          {elig.data.reason === 'ALREADY_REVIEWED'
            ? 'You have already reviewed this product.'
            : 'Only customers who received this product can review it.'}
        </p>
      )}
    </section>
  );
}

export default function ProductDetail() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const notify = useToast();
  const { has, toggle } = useWishlist();
  const [qty, setQty] = useState(1);
  const [img, setImg] = useState(0);
  const q = useQuery({
    queryKey: ['product', slug],
    queryFn: () => api<{ product: Detail }>(`/products/${slug}`),
  });
  const add = useMutation({
    mutationFn: (v: { productId: string; quantity: number }) =>
      api('/cart/items', { method: 'POST', body: v }),
    onSuccess: () => {
      notify('Added to cart');
      void qc.invalidateQueries({ queryKey: ['cart'] });
    },
    onError: (e: Error) => notify(e.message, 'error'),
  });
  if (q.isLoading)
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="aspect-square" />
        <div className="space-y-3">
          <Skeleton className="h-8" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  if (q.isError)
    return (
      <Empty title="Product not found">
        <Link className="text-brand-700 underline" to="/products">
          Browse all products
        </Link>
      </Empty>
    );
  const p = q.data!.product;
  const off =
    p.mrpMinor > p.priceMinor ? Math.round(((p.mrpMinor - p.priceMinor) / p.mrpMinor) * 100) : 0;
  const buy = (goCart: boolean) => {
    if (!user) return nav('/login', { state: { from: loc.pathname } });
    add.mutate({ productId: p.id, quantity: qty }, { onSuccess: () => goCart && nav('/cart') });
  };
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/' },
          { label: p.category.name, to: `/products?category=${p.category.slug}` },
          { label: p.name },
        ]}
      />
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <div className="card aspect-square overflow-hidden">
            {p.images[img] && (
              <img
                src={p.images[img]!.url}
                alt={p.images[img]!.alt}
                className="h-full w-full object-cover"
              />
            )}
          </div>
          {p.images.length > 1 && (
            <div className="mt-2 flex gap-2">
              {p.images.map((im, i) => (
                <button
                  key={i}
                  aria-label={`Show image ${i + 1}`}
                  onClick={() => setImg(i)}
                  className={`h-16 w-16 overflow-hidden rounded border-2 ${i === img ? 'border-brand-600' : 'border-transparent'}`}
                >
                  <img src={im.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-sm text-slate-500">{p.brand}</p>
          <h1 className="text-2xl font-bold">{p.name}</h1>
          <div className="mt-1">
            <Stars value={p.ratingAvg} count={p.ratingCount} />
          </div>
          <div className="mt-4 flex items-baseline gap-3">
            <Price paise={p.priceMinor} className="text-3xl font-bold" />
            {off > 0 && (
              <>
                <Price paise={p.mrpMinor} className="text-slate-500 line-through" />
                <span className="font-semibold text-green-700">{off}% off</span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-500">Inclusive of offers; GST added at checkout.</p>
          <p className="mt-4 text-slate-700">{p.description}</p>
          <p className="mt-2 text-xs text-slate-500">SKU: {p.sku}</p>
          <p
            className={`mt-3 font-semibold ${p.inStock ? (p.lowStock ? 'text-amber-700' : 'text-green-700') : 'text-red-700'}`}
          >
            {p.inStock
              ? p.lowStock
                ? 'Only a few left in stock'
                : 'In stock'
              : 'Currently unavailable'}
          </p>
          {p.inStock && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="text-sm font-medium">
                Qty{' '}
                <select
                  className="input ml-2 w-20"
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value))}
                >
                  {Array.from({ length: p.maxQuantity }, (_, i) => (
                    <option key={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </label>
              <button className="btn-primary" disabled={add.isPending} onClick={() => buy(false)}>
                Add to cart
              </button>
              <button className="btn-dark" disabled={add.isPending} onClick={() => buy(true)}>
                Buy now
              </button>
              <button className="btn-ghost" aria-pressed={has(p.id)} onClick={() => toggle(p.id)}>
                <Heart size={16} className={has(p.id) ? 'fill-red-500 text-red-500' : ''} />
                {has(p.id) ? 'Wishlisted' : 'Wishlist'}
              </button>
            </div>
          )}
          {add.isError && (
            <div className="mt-3">
              <ErrorMessage error={add.error} />
            </div>
          )}
        </div>
      </div>
      <Reviews productId={p.id} />
      {p.related.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-xl font-bold">Related products</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {p.related.map((r) => (
              <ProductCard key={r.id} p={r} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
