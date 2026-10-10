import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { ProductCard, ProductGridSkeleton } from '../components/ProductCard';
import { Empty, ErrorMessage, Field } from '../components/ui';
import { api } from '../lib/api';
import { useWishlist } from '../lib/hooks';

export function Wishlist() {
  const w = useWishlist();
  if (w.isLoading) return <ProductGridSkeleton n={4} />;
  if (w.items.length === 0)
    return (
      <Empty title="Your wishlist is empty">
        <Link to="/products" className="btn-primary mt-3">
          Browse products
        </Link>
      </Empty>
    );
  return (
    <section>
      <h1 className="mb-3 text-2xl font-bold">Your wishlist</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {w.items.map((p) => (
          <ProductCard key={p.id} p={p} />
        ))}
      </div>
    </section>
  );
}

const schema = z.object({
  name: z.string().trim().min(1, 'Required').max(80),
  email: z.string().trim().email('Enter a valid email'),
  subject: z.string().trim().min(3, 'At least 3 characters').max(120),
  message: z.string().trim().min(10, 'At least 10 characters').max(2000),
});
export function Support() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const m = useMutation({
    mutationFn: (v: z.infer<typeof schema>) =>
      api('/support/messages', { method: 'POST', body: v }),
    onSuccess: () => reset(),
  });
  return (
    <div className="card mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Contact support</h1>
      <p className="mb-4 text-sm text-slate-600">Tell us how we can help.</p>
      {m.isSuccess && (
        <p role="status" className="mb-3 rounded-lg bg-green-50 p-3 text-sm text-green-900">
          Thanks! Our team will get back to you by email.
        </p>
      )}
      {m.isError && <ErrorMessage error={m.error} />}
      <form className="space-y-3" noValidate onSubmit={handleSubmit((v) => m.mutate(v))}>
        <Field label="Name" error={errors.name?.message}>
          <input className="input" {...register('name')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <input className="input" type="email" {...register('email')} />
        </Field>
        <Field label="Subject" error={errors.subject?.message}>
          <input className="input" {...register('subject')} />
        </Field>
        <Field label="Message" error={errors.message?.message}>
          <textarea rows={5} className="input" {...register('message')} />
        </Field>
        <button className="btn-dark" disabled={m.isPending}>
          Send message
        </button>
      </form>
    </div>
  );
}

export const NotFound = () => (
  <Empty title="Page not found">
    <Link to="/" className="btn-dark mt-3">
      Go home
    </Link>
  </Empty>
);
