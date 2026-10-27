import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Button, Field, FormError, Input } from '../components/ui';

function Shell({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-2xl font-semibold">OpsMind</p>
        <p className="mb-5 text-sm text-muted">Manufacturing operations analytics</p>
        <div className="rounded border border-line bg-white p-5">
          <h1 className="mb-4 text-lg font-semibold">{title}</h1>
          {children}
        </div>
        <p className="mt-4 text-center text-sm text-muted">{footer}</p>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Sign in" footer={<>New organisation? <Link className="text-accent underline" to="/register">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <FormError error={error} />
        <Field label="Email" error={error instanceof ApiError ? error.fieldMessage('email') : undefined}>
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" error={error instanceof ApiError ? error.fieldMessage('password') : undefined}>
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" busy={busy} className="w-full">Sign in</Button>
      </form>
    </Shell>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ organisationName: '', fullName: '', email: '', password: '' });
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  const fe = (field: string) => (error instanceof ApiError ? error.fieldMessage(field) : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await register({ ...form, email: form.email.trim() });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Create your organisation" footer={<>Already registered? <Link className="text-accent underline" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <FormError error={error} />
        <Field label="Organisation name" error={fe('organisationName')}><Input required value={form.organisationName} onChange={set('organisationName')} /></Field>
        <Field label="Your name" error={fe('fullName')}><Input required autoComplete="name" value={form.fullName} onChange={set('fullName')} /></Field>
        <Field label="Email" error={fe('email')}><Input type="email" required autoComplete="username" value={form.email} onChange={set('email')} /></Field>
        <Field label="Password" hint="At least 10 characters, with a letter and a number." error={fe('password')}>
          <Input type="password" required autoComplete="new-password" value={form.password} onChange={set('password')} />
        </Field>
        <Button type="submit" busy={busy} className="w-full">Create account</Button>
      </form>
    </Shell>
  );
}
