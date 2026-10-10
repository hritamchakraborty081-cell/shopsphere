import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PRODUCT_SORTS } from '@shopsphere/shared';
import { Breadcrumbs } from '../components/Layout';
import { ProductCard, ProductGridSkeleton } from '../components/ProductCard';
import { Empty, ErrorMessage, Pagination } from '../components/ui';
import { api } from '../lib/api';
import type { Category, Paged, ProductCardData } from '../lib/types';

const SORT_LABELS: Record<string, string> = {
  relevance: 'Featured',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  rating: 'Avg. rating',
  newest: 'Newest',
};
const PRICE_RANGES = [
  ['', 'Any price'],
  ['0-50000', 'Under ₹500'],
  ['50000-200000', '₹500 – ₹2,000'],
  ['200000-500000', '₹2,000 – ₹5,000'],
  ['500000-', 'Over ₹5,000'],
] as const;

export default function Products() {
  const [sp, setSp] = useSearchParams();
  // Filters start collapsed on phones (so products are visible first) and open on desktop.
  const [filtersOpen, setFiltersOpen] = useState(
    () => !!window.matchMedia?.('(min-width: 1024px)').matches,
  );
  const get = (k: string) => sp.get(k) ?? '';
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setSp(next);
  };
  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ items: Category[] }>('/categories'),
  });
  const qs = sp.toString();
  const list = useQuery({
    queryKey: ['products', 'list', qs],
    queryFn: () => api<Paged<ProductCardData>>(`/products?${qs}`),
    placeholderData: (prev) => prev,
  });
  const range = `${get('minPrice')}-${get('maxPrice')}`;
  const q = get('q');
  const catName = cats.data?.items.find((c) => c.slug === get('category'))?.name;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/' },
          { label: q ? `Results for "${q}"` : (catName ?? 'All products') },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside aria-label="Filters">
          <details
            className="card p-4"
            open={filtersOpen}
            onToggle={(e) => setFiltersOpen(e.currentTarget.open)}
          >
            <summary className="flex cursor-pointer items-center gap-2 font-semibold lg:pointer-events-none">
              <SlidersHorizontal size={16} />
              Filters
            </summary>
            <div className="mt-4 space-y-4 text-sm">
              <label className="block font-medium">
                Category
                <select
                  className="input mt-1"
                  value={get('category')}
                  onChange={(e) => set({ category: e.target.value })}
                >
                  <option value="">All categories</option>
                  {cats.data?.items.map((c) => (
                    <option key={c.id} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block font-medium">
                Price
                <select
                  className="input mt-1"
                  value={range === '-' ? '' : range}
                  onChange={(e) => {
                    const [a = '', b = ''] = e.target.value.split('-');
                    set({ minPrice: a, maxPrice: b });
                  }}
                >
                  {PRICE_RANGES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block font-medium">
                Customer rating
                <select
                  className="input mt-1"
                  value={get('minRating')}
                  onChange={(e) => set({ minRating: e.target.value })}
                >
                  <option value="">Any</option>
                  <option value="4">4★ & up</option>
                  <option value="3">3★ & up</option>
                </select>
              </label>
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={get('inStock') === 'true'}
                  onChange={(e) => set({ inStock: e.target.checked ? 'true' : '' })}
                />
                In stock only
              </label>
              <button className="btn-ghost w-full" onClick={() => setSp(q ? { q } : {})}>
                Clear filters
              </button>
            </div>
          </details>
        </aside>
        <section aria-live="polite">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              {list.data
                ? `${list.data.total} result${list.data.total === 1 ? '' : 's'}`
                : 'Loading…'}
            </p>
            <label className="flex items-center gap-2 text-sm">
              Sort by
              <select
                className="input w-auto"
                value={get('sort') || 'relevance'}
                onChange={(e) => set({ sort: e.target.value })}
              >
                {PRODUCT_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {list.isError ? (
            <ErrorMessage error={list.error} />
          ) : list.isLoading ? (
            <ProductGridSkeleton />
          ) : list.data!.items.length === 0 ? (
            <Empty title="No products found">
              Try a different search or{' '}
              <button className="text-brand-700 underline" onClick={() => setSp({})}>
                clear all filters
              </button>
              .
            </Empty>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {list.data!.items.map((p) => (
                  <ProductCard key={p.id} p={p} />
                ))}
              </div>
              <Pagination
                page={list.data!.page}
                totalPages={list.data!.totalPages ?? 1}
                onPage={(p) => {
                  set({ page: String(p) });
                  window.scrollTo({ top: 0 });
                }}
              />
            </>
          )}
        </section>
      </div>
    </>
  );
}
