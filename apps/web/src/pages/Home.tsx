import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ProductCard, ProductGridSkeleton } from '../components/ProductCard';
import { api } from '../lib/api';
import type { Category, Paged, ProductCardData } from '../lib/types';

function Row({ title, query, to }: { title: string; query: string; to: string }) {
  const q = useQuery({
    queryKey: ['products', query],
    queryFn: () => api<Paged<ProductCardData>>(`/products?${query}`),
  });
  return (
    <section className="mt-10" aria-labelledby={`h-${title}`}>
      <div className="mb-3 flex items-end justify-between">
        <h2 id={`h-${title}`} className="text-xl font-bold">
          {title}
        </h2>
        <Link to={to} className="text-sm font-medium text-brand-700 hover:underline">
          See all
        </Link>
      </div>
      {q.isLoading ? (
        <ProductGridSkeleton n={4} />
      ) : q.isError ? (
        <p role="alert" className="text-red-700">
          Could not load products.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {q.data!.items.map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ items: Category[] }>('/categories'),
  });
  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl bg-gradient-to-br from-brand-700 to-indigo-400 p-8 text-white md:col-span-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-amber-300">
            Welcome offer
          </p>
          <h1 className="mt-2 text-3xl font-extrabold md:text-4xl">
            Everything you need, delivered.
          </h1>
          <p className="mt-2 max-w-md text-indigo-100">
            Use code <strong>WELCOME10</strong> for 10% off orders above ₹500.
          </p>
          <Link to="/products" className="btn-primary mt-5">
            Start shopping
          </Link>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-amber-300 to-orange-400 p-8 text-slate-900">
          <h2 className="text-xl font-bold">Free standard delivery</h2>
          <p className="mt-1 text-sm">On orders above ₹500.</p>
          <Link to="/products?sort=newest" className="btn-dark mt-5">
            New arrivals
          </Link>
        </div>
      </div>
      <section className="mt-10" aria-labelledby="cats">
        <h2 id="cats" className="mb-3 text-xl font-bold">
          Shop by category
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
          {cats.data?.items.map((c) => (
            <Link
              key={c.id}
              to={`/products?category=${c.slug}`}
              className="card p-4 text-center text-sm font-medium hover:border-brand-600 hover:text-brand-700"
            >
              {c.name}
              <span className="block text-xs font-normal text-slate-500">
                {c.productCount} items
              </span>
            </Link>
          ))}
        </div>
      </section>
      <Row title="Top rated" query="sort=rating&pageSize=4" to="/products?sort=rating" />
      <Row title="New arrivals" query="sort=newest&pageSize=4" to="/products?sort=newest" />
      <Row
        title="Deals under ₹1,000"
        query="maxPrice=100000&sort=price_asc&pageSize=4"
        to="/products?maxPrice=100000"
      />
    </>
  );
}
