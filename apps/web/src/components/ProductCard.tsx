import { Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ProductCardData } from '../lib/types';
import { useWishlist } from '../lib/hooks';
import { Price, Stars } from './ui';

export function ProductCard({ p }: { p: ProductCardData }) {
  const { has, toggle } = useWishlist();
  const off =
    p.mrpMinor > p.priceMinor ? Math.round(((p.mrpMinor - p.priceMinor) / p.mrpMinor) * 100) : 0;
  const wished = has(p.id);
  return (
    <article className="card group relative flex flex-col overflow-hidden">
      <button
        aria-label={wished ? `Remove ${p.name} from wishlist` : `Add ${p.name} to wishlist`}
        aria-pressed={wished}
        onClick={() => toggle(p.id)}
        className="absolute right-2 top-2 z-10 rounded-full bg-white/90 p-2 shadow hover:bg-white"
      >
        <Heart size={16} className={wished ? 'fill-red-500 text-red-500' : 'text-slate-600'} />
      </button>
      <Link to={`/products/${p.slug}`} className="block aspect-square overflow-hidden bg-slate-100">
        {p.image && (
          <img
            src={p.image.url}
            alt={p.image.alt}
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="text-xs text-slate-500">{p.brand}</p>
        <Link
          to={`/products/${p.slug}`}
          className="line-clamp-2 text-sm font-medium hover:text-brand-700"
        >
          {p.name}
        </Link>
        <Stars value={p.ratingAvg} count={p.ratingCount} />
        <div className="mt-auto flex items-baseline gap-2 pt-2">
          <Price paise={p.priceMinor} className="text-lg font-bold" />
          {off > 0 && (
            <>
              <Price paise={p.mrpMinor} className="text-xs text-slate-500 line-through" />
              <span className="text-xs font-semibold text-green-700">{off}% off</span>
            </>
          )}
        </div>
        {!p.inStock ? (
          <p className="text-xs font-semibold text-red-700">Out of stock</p>
        ) : p.lowStock ? (
          <p className="text-xs font-semibold text-amber-700">Only a few left</p>
        ) : null}
      </div>
    </article>
  );
}

export const ProductGridSkeleton = ({ n = 8 }: { n?: number }) => (
  <div
    className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4"
    aria-busy="true"
    aria-label="Loading products"
  >
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className="card animate-pulse">
        <div className="aspect-square bg-slate-200" />
        <div className="space-y-2 p-3">
          <div className="h-3 w-1/2 rounded bg-slate-200" />
          <div className="h-4 rounded bg-slate-200" />
          <div className="h-5 w-1/3 rounded bg-slate-200" />
        </div>
      </div>
    ))}
  </div>
);
