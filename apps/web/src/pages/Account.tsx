import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErrorMessage, Field, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Address } from '../lib/types';
import { passwordRule } from './AuthPages';
import { AddressForm } from './Checkout';

export default function Account() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const notify = useToast();
  const addrs = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api<{ items: Address[] }>('/users/me/addresses'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/users/me/addresses/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) =>
      api(`/users/me/addresses/${id}`, { method: 'PATCH', body: { isDefault: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
  });
  const profile = useForm<{ name: string }>({
    defaultValues: { name: user?.name ?? '' },
    resolver: zodResolver(z.object({ name: z.string().trim().min(1).max(80) })),
  });
  const saveName = useMutation({
    mutationFn: (v: { name: string }) => api('/users/me', { method: 'PATCH', body: v }),
    onSuccess: () => {
      notify('Profile updated');
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const schema = z.object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: passwordRule,
  });
  const pw = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const changePw = useMutation({
    mutationFn: (v: z.infer<typeof schema>) =>
      api('/users/me/password', { method: 'POST', body: v }),
    onSuccess: () => {
      notify('Password changed');
      pw.reset();
    },
  });
  const resend = useMutation({
    mutationFn: () =>
      api('/auth/resend-verification', { method: 'POST', body: { email: user?.email } }),
    onSuccess: () => notify('Verification email sent'),
  });
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Your account</h1>
      <section className="card p-4" aria-labelledby="p-h">
        <h2 id="p-h" className="mb-3 font-semibold">
          Profile
        </h2>
        <p className="mb-3 text-sm text-slate-600">
          {user?.email} ·{' '}
          {user?.emailVerified ? (
            'Email verified'
          ) : (
            <>
              Email not verified.{' '}
              <button className="text-brand-700 underline" onClick={() => resend.mutate()}>
                Resend link
              </button>
            </>
          )}
        </p>
        <form
          className="flex items-end gap-3"
          onSubmit={profile.handleSubmit((v) => saveName.mutate(v))}
        >
          <div className="flex-1">
            <Field label="Name">
              <input className="input" {...profile.register('name')} />
            </Field>
          </div>
          <button className="btn-dark">Save</button>
        </form>
      </section>
      <section className="card p-4" aria-labelledby="a-h">
        <h2 id="a-h" className="mb-3 font-semibold">
          Address book
        </h2>
        <ul className="mb-4 space-y-2">
          {addrs.data?.items.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3 text-sm"
            >
              <span>
                <strong>{a.fullName}</strong>{' '}
                {a.isDefault && (
                  <em className="rounded bg-green-100 px-1 text-xs not-italic text-green-800">
                    Default
                  </em>
                )}
                <br />
                {a.line1}
                {a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} {a.postalCode}
              </span>
              <span className="flex gap-3">
                {!a.isDefault && (
                  <button
                    className="text-brand-700 underline"
                    onClick={() => makeDefault.mutate(a.id)}
                  >
                    Make default
                  </button>
                )}
                <button className="text-red-700 underline" onClick={() => del.mutate(a.id)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
        <h3 className="mb-2 text-sm font-semibold">Add a new address</h3>
        <AddressForm onDone={() => notify('Address saved')} />
      </section>
      <section className="card p-4" aria-labelledby="pw-h">
        <h2 id="pw-h" className="mb-3 font-semibold">
          Change password
        </h2>
        {changePw.isError && <ErrorMessage error={changePw.error} />}
        <form
          className="grid gap-3 sm:grid-cols-2"
          noValidate
          onSubmit={pw.handleSubmit((v) => changePw.mutate(v))}
        >
          <Field label="Current password" error={pw.formState.errors.currentPassword?.message}>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              {...pw.register('currentPassword')}
            />
          </Field>
          <Field label="New password" error={pw.formState.errors.newPassword?.message}>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              {...pw.register('newPassword')}
            />
          </Field>
          <div>
            <button className="btn-dark">Update password</button>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          Changing your password signs you out on other devices.
        </p>
      </section>
    </div>
  );
}
