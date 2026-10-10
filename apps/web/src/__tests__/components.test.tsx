import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductCard } from '../components/ProductCard';
import { Pagination, Price, Stars, ToastProvider } from '../components/ui';
import { AuthProvider } from '../lib/auth';
import { Login, Register } from '../pages/AuthPages';

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>{ui}</AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};
const mockFetch = (handler: (url: string, init?: RequestInit) => unknown) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async (url, init) =>
        new Response(JSON.stringify(handler(String(url), init)), { status: 200 }),
    );
afterEach(() => vi.restoreAllMocks());

describe('presentational components', () => {
  it('formats prices in INR from integer paise', () => {
    render(<Price paise={129900} />);
    expect(screen.getByText(/1,299\.00/)).toBeInTheDocument();
  });
  it('exposes ratings to assistive tech', () => {
    render(<Stars value={4.5} count={12} />);
    expect(screen.getByLabelText(/Rated 4.5 out of 5 from 12 reviews/)).toBeInTheDocument();
  });
  it('pagination disables boundaries and reports page changes', async () => {
    const onPage = vi.fn();
    render(<Pagination page={1} totalPages={3} onPage={onPage} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
  it('product card shows discount, low stock and an accessible wishlist button', () => {
    mockFetch(() => ({ user: null, csrfToken: null }));
    wrap(
      <ProductCard
        p={{
          id: '1',
          slug: 's',
          name: 'Test Lamp',
          brand: 'Glow',
          priceMinor: 80000,
          mrpMinor: 100000,
          ratingAvg: 4,
          ratingCount: 3,
          image: { url: '/products/x.svg', alt: 'Test Lamp' },
          inStock: true,
          lowStock: true,
        }}
      />,
    );
    expect(screen.getByText('20% off')).toBeInTheDocument();
    expect(screen.getByText('Only a few left')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Test Lamp to wishlist/ })).toBeInTheDocument();
  });
});

describe('form validation (client side is UX only; the API validates again)', () => {
  it('login shows required-field errors without calling the login endpoint', async () => {
    const spy = mockFetch(() => ({ user: null, csrfToken: null }));
    wrap(<Login />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(spy.mock.calls.some(([u]) => String(u).includes('/auth/login'))).toBe(false);
  });

  it('register enforces password strength and matching confirmation', async () => {
    mockFetch(() => ({ user: null, csrfToken: null }));
    wrap(<Register />);
    await userEvent.type(screen.getByLabelText('Full name'), 'Asha');
    await userEvent.type(screen.getByLabelText('Email'), 'asha@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(screen.getByText(/At least 12 characters/)).toBeInTheDocument());
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
  });
});
