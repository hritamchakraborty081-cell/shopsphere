import { Heart, Menu, Package, Search, ShoppingCart, User as UserIcon, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useCart } from '../lib/hooks';

export function Layout() {
  const { user, logout } = useAuth();
  const cart = useCart();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const count = cart.data?.itemCount ?? 0;
  const search = (e: FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    if (t) {
      nav(`/products?q=${encodeURIComponent(t)}`);
      setOpen(false);
    }
  };
  const link = 'rounded px-2 py-1 hover:bg-white/10';
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 bg-brand-900 text-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <button
            className="md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
          <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <span className="inline-block h-6 w-6 rounded-full bg-amber-400" aria-hidden="true" />
            ShopSphere
          </Link>
          <form onSubmit={search} role="search" className="hidden flex-1 md:flex">
            <input
              aria-label="Search products"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={80}
              placeholder="Search ShopSphere"
              className="w-full rounded-l-lg px-3 py-2 text-sm text-slate-900 focus:outline-none"
            />
            <button className="rounded-r-lg bg-amber-400 px-4 text-slate-900" aria-label="Search">
              <Search size={18} />
            </button>
          </form>
          <nav aria-label="Main" className="ml-auto hidden items-center gap-1 text-sm md:flex">
            {user ? (
              <>
                <NavLink to="/orders" className={link}>
                  Orders
                </NavLink>
                <NavLink to="/wishlist" className={link} aria-label="Wishlist">
                  <Heart size={18} />
                </NavLink>
                <NavLink to="/account" className={link}>
                  <UserIcon className="mr-1 inline" size={16} />
                  {user.name.split(' ')[0]}
                </NavLink>
                {user.role === 'ADMIN' && (
                  <NavLink to="/admin" className={`${link} text-amber-300`}>
                    Admin
                  </NavLink>
                )}
                <button
                  className={link}
                  onClick={() => {
                    void logout().then(() => nav('/'));
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={link}>
                  Sign in
                </NavLink>
                <NavLink to="/register" className={link}>
                  Register
                </NavLink>
              </>
            )}
          </nav>
          <Link
            to="/cart"
            aria-label={`Cart, ${count} items`}
            className="relative ml-auto rounded p-2 hover:bg-white/10 md:ml-0"
          >
            <ShoppingCart />
            {count > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-amber-400 px-1.5 text-xs font-bold text-slate-900">
                {count}
              </span>
            )}
          </Link>
        </div>
        {open && (
          <div className="border-t border-white/10 px-4 pb-4 md:hidden">
            <form onSubmit={search} role="search" className="my-3 flex">
              <input
                aria-label="Search products"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                maxLength={80}
                placeholder="Search ShopSphere"
                className="w-full rounded-l-lg px-3 py-2 text-sm text-slate-900"
              />
              <button className="rounded-r-lg bg-amber-400 px-4 text-slate-900" aria-label="Search">
                <Search size={18} />
              </button>
            </form>
            <nav
              aria-label="Mobile"
              className="flex flex-col gap-1 text-sm"
              onClick={() => setOpen(false)}
            >
              <Link to="/products" className={link}>
                All products
              </Link>
              {user ? (
                <>
                  <Link to="/orders" className={link}>
                    <Package className="mr-1 inline" size={14} />
                    Orders
                  </Link>
                  <Link to="/wishlist" className={link}>
                    Wishlist
                  </Link>
                  <Link to="/account" className={link}>
                    Account
                  </Link>
                  {user.role === 'ADMIN' && (
                    <Link to="/admin" className={`${link} text-amber-300`}>
                      Admin
                    </Link>
                  )}
                  <button
                    className={`${link} text-left`}
                    onClick={() => {
                      void logout().then(() => nav('/'));
                    }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login" className={link}>
                    Sign in
                  </Link>
                  <Link to="/register" className={link}>
                    Register
                  </Link>
                </>
              )}
              <Link to="/support" className={link}>
                Help & support
              </Link>
            </nav>
          </div>
        )}
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="mt-10 bg-slate-900 text-sm text-slate-300">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-4 px-4 py-8">
          <div>
            <p className="font-bold text-white">ShopSphere</p>
            <p className="mt-1 max-w-xs text-slate-400">
              An original portfolio project. Payments are simulated (mock mode); no real money is
              handled.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-col gap-1">
            <Link to="/products" className="hover:text-white">
              Shop
            </Link>
            <Link to="/support" className="hover:text-white">
              Support
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500">
      <ol className="flex flex-wrap gap-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1">
            {i > 0 && <span aria-hidden="true">/</span>}
            {it.to ? (
              <Link to={it.to} className="hover:underline">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-slate-800">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
