import { useState, type FormEvent } from 'react';
import { auth } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useSubmit } from '../lib/useSubmit';
import { Banner, Button, Card, Field, FormError, Input, PageHeader } from '../components/ui';

export function SettingsPage() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.fullName ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string>();
  const profile = useSubmit();
  const pw = useSubmit();

  async function saveProfile(e: FormEvent) {
    e.preventDefault(); setMsg(undefined);
    const r = await profile.run(() => auth.updateProfile(name));
    if (r.ok) { setUser(r.value); setMsg('Profile updated.'); }
  }
  async function savePassword(e: FormEvent) {
    e.preventDefault(); setMsg(undefined);
    const r = await pw.run(() => auth.changePassword(current, next));
    if (r.ok) { setCurrent(''); setNext(''); setMsg('Password changed.'); }
  }

  return (
    <>
      <PageHeader title="Account" description={`${user?.email} · ${user?.role} · ${user?.organisationName}`} />
      {msg && <div className="mb-4"><Banner tone="success">{msg}</Banner></div>}
      <div className="grid max-w-3xl gap-5 md:grid-cols-2">
        <Card title="Profile">
          <form onSubmit={saveProfile} className="space-y-3" noValidate>
            <FormError error={profile.error} />
            <Field label="Full name" error={profile.fieldError('fullName')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Button type="submit" busy={profile.busy}>Save profile</Button>
          </form>
        </Card>
        <Card title="Change password">
          <form onSubmit={savePassword} className="space-y-3" noValidate>
            <FormError error={pw.error} />
            <Field label="Current password" error={pw.fieldError('currentPassword')}><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
            <Field label="New password" hint="At least 10 characters, with a letter and a number." error={pw.fieldError('newPassword')}><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
            <Button type="submit" busy={pw.busy}>Change password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
