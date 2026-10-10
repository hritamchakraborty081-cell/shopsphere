import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from '@shopsphere/shared';
import { ErrorMessage, Field } from '../components/ui';
import { ApiError, api, safeRedirect } from '../lib/api';
import { useAuth } from '../lib/auth';

const email = z.string().trim().toLowerCase().email('Enter a valid email address');
export const passwordRule = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `At least ${PASSWORD_MIN_LENGTH} characters`)
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/\d/, 'Include a number');
const Shell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="card mx-auto max-w-md p-6">
    <h1 className="mb-4 text-2xl font-bold">{title}</h1>
    {children}
  </div>
);

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string; password: string }>({
    resolver: zodResolver(z.object({ email, password: z.string().min(1, 'Enter your password') })),
  });
  return (
    <Shell title="Sign in">
      <form
        className="space-y-4"
        noValidate
        onSubmit={handleSubmit(async (v) => {
          setError(null);
          try {
            await login(v.email, v.password);
            nav(safeRedirect((loc.state as { from?: string } | null)?.from), { replace: true });
          } catch (e) {
            setError(e);
          }
        })}
      >
        {error != null && <ErrorMessage error={error} />}
        <Field label="Email" error={errors.email?.message}>
          <input className="input" type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
        </Field>
        <button className="btn-dark w-full" disabled={isSubmitting}>
          Sign in
        </button>
        <div className="flex justify-between text-sm">
          <Link className="text-brand-700 hover:underline" to="/forgot-password">
            Forgot password?
          </Link>
          <Link className="text-brand-700 hover:underline" to="/register">
            Create account
          </Link>
        </div>
      </form>
    </Shell>
  );
}

export function Register() {
  const [done, setDone] = useState(false);
  const schema = z
    .object({
      name: z.string().trim().min(1, 'Enter your name').max(80),
      email,
      password: passwordRule,
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, {
      path: ['confirm'],
      message: 'Passwords do not match',
    });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const m = useMutation({
    mutationFn: (v: { name: string; email: string; password: string }) =>
      api('/auth/register', { method: 'POST', body: v }),
    onSuccess: () => setDone(true),
  });
  if (done)
    return (
      <Shell title="Check your email">
        <p>
          If this email can be registered, we have sent a verification link. It expires in 24 hours.
        </p>
        {import.meta.env.DEV && (
          <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-900">
            Dev mode: emails are captured at <code>/api/v1/dev/outbox</code>.
          </p>
        )}
        <Link className="btn-dark mt-4" to="/login">
          Go to sign in
        </Link>
      </Shell>
    );
  return (
    <Shell title="Create your account">
      <form
        className="space-y-4"
        noValidate
        onSubmit={handleSubmit(({ name, email: e, password }) =>
          m.mutate({ name, email: e, password }),
        )}
      >
        {m.isError && <ErrorMessage error={m.error} />}
        <Field label="Full name" error={errors.name?.message}>
          <input className="input" autoComplete="name" {...register('name')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <input className="input" type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            {...register('password')}
          />
        </Field>
        <Field label="Confirm password" error={errors.confirm?.message}>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            {...register('confirm')}
          />
        </Field>
        <button className="btn-dark w-full" disabled={m.isPending}>
          Create account
        </button>
        <p className="text-sm">
          Already registered?{' '}
          <Link className="text-brand-700 hover:underline" to="/login">
            Sign in
          </Link>
        </p>
      </form>
    </Shell>
  );
}

export function VerifyEmail() {
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const [state, setState] = useState<'working' | 'ok' | 'bad'>('working');
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    api('/auth/verify-email', { method: 'POST', body: { token } }).then(
      () => setState('ok'),
      () => setState('bad'),
    );
  }, [token]);
  return (
    <Shell title="Email verification">
      {state === 'working' && <p>Verifying…</p>}
      {state === 'ok' && (
        <>
          <p role="status">Your email is verified. You can now place orders.</p>
          <Link className="btn-dark mt-4" to="/login">
            Sign in
          </Link>
        </>
      )}
      {state === 'bad' && (
        <p role="alert">
          This link is invalid or has expired. Sign in and request a new one from your account page.
        </p>
      )}
    </Shell>
  );
}

export function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email })) });
  const m = useMutation({
    mutationFn: (v: { email: string }) => api('/auth/forgot-password', { method: 'POST', body: v }),
    onSuccess: () => setSent(true),
  });
  return (
    <Shell title="Reset your password">
      {sent ? (
        <p role="status">
          If an account exists for that email, a reset link is on its way. The link works once and
          expires in 1 hour.
        </p>
      ) : (
        <form className="space-y-4" noValidate onSubmit={handleSubmit((v) => m.mutate(v))}>
          {m.isError && <ErrorMessage error={m.error} />}
          <Field label="Email" error={errors.email?.message}>
            <input className="input" type="email" autoComplete="email" {...register('email')} />
          </Field>
          <button className="btn-dark w-full" disabled={m.isPending}>
            Send reset link
          </button>
        </form>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const schema = z
    .object({ password: passwordRule, confirm: z.string() })
    .refine((v) => v.password === v.confirm, {
      path: ['confirm'],
      message: 'Passwords do not match',
    });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const m = useMutation({
    mutationFn: (password: string) =>
      api('/auth/reset-password', {
        method: 'POST',
        body: { token: sp.get('token') ?? '', password },
      }),
    onSuccess: () => nav('/login'),
  });
  return (
    <Shell title="Choose a new password">
      <form className="space-y-4" noValidate onSubmit={handleSubmit((v) => m.mutate(v.password))}>
        {m.isError && (
          <ErrorMessage
            error={
              m.error instanceof ApiError && m.error.code === 'INVALID_TOKEN'
                ? new Error('This reset link is invalid or has expired.')
                : m.error
            }
          />
        )}
        <Field label="New password" error={errors.password?.message}>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            {...register('password')}
          />
        </Field>
        <Field label="Confirm password" error={errors.confirm?.message}>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            {...register('confirm')}
          />
        </Field>
        <button className="btn-dark w-full" disabled={m.isPending}>
          Update password
        </button>
      </form>
    </Shell>
  );
}
