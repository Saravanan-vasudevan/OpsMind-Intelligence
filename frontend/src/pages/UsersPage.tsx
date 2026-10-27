import { useState, type FormEvent } from 'react';
import { users as usersApi } from '../api/endpoints';
import type { Role, User } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { useSubmit } from '../lib/useSubmit';
import { useAuth } from '../auth/AuthContext';
import { formatDate } from '../lib/format';
import { Badge, Button, DataTable, ErrorState, Field, FormError, Input, LoadingBlock, Modal, PageHeader, Select } from '../components/ui';

function CreateUserForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ fullName: '', email: '', password: '', role: 'User' as Role });
  const s = useSubmit();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await s.run(() => usersApi.create({ ...f, email: f.email.trim() }));
    if (r.ok) onDone();
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormError error={s.error} />
      <Field label="Full name" error={s.fieldError('fullName')}><Input required value={f.fullName} onChange={set('fullName')} /></Field>
      <Field label="Email" error={s.fieldError('email')}><Input type="email" required value={f.email} onChange={set('email')} /></Field>
      <Field label="Temporary password" hint="At least 10 characters, with a letter and a number." error={s.fieldError('password')}><Input type="password" autoComplete="new-password" required value={f.password} onChange={set('password')} /></Field>
      <Field label="Role" error={s.fieldError('role')}><Select value={f.role} onChange={set('role')}><option value="User">User – can enter data and view analytics</option><option value="Admin">Admin – can also manage structure and users</option></Select></Field>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" busy={s.busy}>Create user</Button></div>
    </form>
  );
}

export function UsersPage() {
  const { user: me } = useAuth();
  const list = useAsync(() => usersApi.list(), []);
  const [creating, setCreating] = useState(false);
  const upd = useSubmit();

  async function change(u: User, patch: Partial<Pick<User, 'role' | 'isActive'>>) {
    const r = await upd.run(() => usersApi.update(u.id, { fullName: u.fullName, role: patch.role ?? u.role, isActive: patch.isActive ?? u.isActive }));
    if (r.ok) list.reload();
  }

  return (
    <>
      <PageHeader title="Users" description="People in your organisation. Deactivated users are signed out on their next request." actions={<Button onClick={() => setCreating(true)}>Add user</Button>} />
      <div className="mb-3"><FormError error={upd.error} /></div>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <LoadingBlock /> : (
        <DataTable caption="Users" rows={list.data ?? []} rowKey={(u) => u.id} columns={[
          { header: 'Name', cell: (u) => u.fullName }, { header: 'Email', cell: (u) => u.email },
          { header: 'Role', cell: (u) => (
            <Select aria-label={`Role for ${u.fullName}`} value={u.role} disabled={u.id === me?.id} onChange={(e) => change(u, { role: e.target.value as Role })} className="!w-auto">
              <option>User</option><option>Admin</option></Select>) },
          { header: 'Status', cell: (u) => <Badge tone={u.isActive ? 'ok' : 'neutral'}>{u.isActive ? 'Active' : 'Deactivated'}</Badge> },
          { header: 'Created', cell: (u) => formatDate(u.createdAt) },
          { header: 'Actions', cell: (u) => u.id === me?.id ? <span className="text-muted">You</span> : (
            <Button variant="ghost" onClick={() => change(u, { isActive: !u.isActive })}>{u.isActive ? 'Deactivate' : 'Reactivate'}</Button>) },
        ]} />
      )}
      {creating && <Modal title="Add user" onClose={() => setCreating(false)}><CreateUserForm onCancel={() => setCreating(false)} onDone={() => { setCreating(false); list.reload(); }} /></Modal>}
    </>
  );
}
