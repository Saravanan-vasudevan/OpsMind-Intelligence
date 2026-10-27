import { useState, type FormEvent } from 'react';
import { categories as catApi, equipment as eqApi, lines as linesApi, plants as plantsApi, type EquipmentInput } from '../api/endpoints';
import type { Category, Equipment, EquipmentStatus } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { useSubmit } from '../lib/useSubmit';
import { useAuth } from '../auth/AuthContext';
import { formatNumber } from '../lib/format';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, FormError, Input, LoadingBlock, Modal, PageHeader, Pagination, Select,
} from '../components/ui';

const statuses: EquipmentStatus[] = ['Active', 'Maintenance', 'Inactive'];

function EquipmentForm({ item, onDone, onCancel }: { item?: Equipment; onDone: () => void; onCancel: () => void }) {
  const lines = useAsync(() => linesApi.list(), []);
  const cats = useAsync(() => catApi.list(), []);
  const [form, setForm] = useState({
    productionLineId: item?.productionLineId ?? '', categoryId: item?.categoryId ?? '', assetCode: item?.assetCode ?? '',
    name: item?.name ?? '', rate: item?.idealRatePerHour?.toString() ?? '', commissionedOn: item?.commissionedOn ?? '',
    status: (item?.status ?? 'Active') as EquipmentStatus,
  });
  const s = useSubmit();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: EquipmentInput = {
      productionLineId: form.productionLineId, categoryId: form.categoryId, assetCode: form.assetCode, name: form.name,
      idealRatePerHour: form.rate === '' ? null : Number(form.rate), commissionedOn: form.commissionedOn || null, status: form.status,
    };
    const r = await s.run(() => (item ? eqApi.update(item.id, body) : eqApi.create(body)));
    if (r.ok) onDone();
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormError error={s.error} />
      <Field label="Production line" error={s.fieldError('productionLineId')}>
        <Select required value={form.productionLineId} onChange={set('productionLineId')}>
          <option value="">Select a line</option>
          {(lines.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.plantName} / {l.name}</option>)}
        </Select>
      </Field>
      <Field label="Category" error={s.fieldError('categoryId')}>
        <Select required value={form.categoryId} onChange={set('categoryId')}>
          <option value="">Select a category</option>
          {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Asset code" error={s.fieldError('assetCode')}><Input required value={form.assetCode} onChange={set('assetCode')} /></Field>
        <Field label="Status" error={s.fieldError('status')}><Select value={form.status} onChange={set('status')}>{statuses.map((x) => <option key={x}>{x}</option>)}</Select></Field>
      </div>
      <Field label="Name" error={s.fieldError('name')}><Input required value={form.name} onChange={set('name')} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ideal rate (units/hour)" hint="Optional." error={s.fieldError('idealRatePerHour')}><Input type="number" min="0" step="any" value={form.rate} onChange={set('rate')} /></Field>
        <Field label="Commissioned on" hint="Optional." error={s.fieldError('commissionedOn')}><Input type="date" value={form.commissionedOn} onChange={set('commissionedOn')} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" busy={s.busy}>{item ? 'Save changes' : 'Add equipment'}</Button>
      </div>
    </form>
  );
}

function CategoryManager({ onChanged }: { onChanged: () => void }) {
  const list = useAsync(() => catApi.list(), []);
  const [name, setName] = useState('');
  const s = useSubmit();
  const rm = useSubmit();
  async function add(e: FormEvent) {
    e.preventDefault();
    const r = await s.run(() => catApi.create(name));
    if (r.ok) { setName(''); list.reload(); onChanged(); }
  }
  async function remove(c: Category) {
    const r = await rm.run(() => catApi.remove(c.id));
    if (r.ok) { list.reload(); onChanged(); }
  }
  return (
    <div className="space-y-3">
      <form onSubmit={add} className="flex items-end gap-2" noValidate>
        <div className="flex-1"><Field label="New category" error={s.fieldError('name')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
        <Button type="submit" busy={s.busy}>Add</Button>
      </form>
      <FormError error={s.error ?? rm.error} />
      <ul className="divide-y divide-line rounded border border-line text-sm">
        {(list.data ?? []).map((c) => (
          <li key={c.id} className="flex items-center justify-between px-3 py-1.5">
            <span>{c.name} <span className="text-muted">({c.equipmentCount})</span></span>
            <Button variant="ghost" aria-label={`Delete category ${c.name}`} onClick={() => remove(c)}>Delete</Button>
          </li>
        ))}
        {list.data?.length === 0 && <li className="px-3 py-2 text-muted">No categories yet.</li>}
      </ul>
    </div>
  );
}

export function EquipmentPage() {
  const { isAdmin } = useAuth();
  const [plantId, setPlantId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const plants = useAsync(() => plantsApi.list(), []);
  const list = useAsync((sig) => { void sig; return eqApi.list({ plantId: plantId || undefined, search: search.trim() || undefined, page, pageSize: 20 }); }, [plantId, search, page]);
  const [editing, setEditing] = useState<Equipment | 'new' | null>(null);
  const [cats, setCats] = useState(false);
  const [deleting, setDeleting] = useState<Equipment | null>(null);
  const del = useSubmit();

  async function confirmDelete() {
    if (!deleting) return;
    const r = await del.run(() => eqApi.remove(deleting.id));
    if (r.ok) { setDeleting(null); list.reload(); }
  }
  const tone = (s: EquipmentStatus) => (s === 'Active' ? 'ok' : s === 'Maintenance' ? 'warn' : 'neutral');

  return (
    <>
      <PageHeader
        title="Equipment"
        description="Machines and assets that production and downtime are recorded against."
        actions={isAdmin ? <><Button variant="secondary" onClick={() => setCats(true)}>Categories</Button><Button onClick={() => setEditing('new')}>Add equipment</Button></> : undefined}
      />
      <div className="mb-4 flex flex-wrap gap-3 rounded border border-line bg-white p-3">
        <div className="w-52"><Field label="Plant"><Select value={plantId} onChange={(e) => { setPlantId(e.target.value); setPage(1); }}>
          <option value="">All plants</option>{(plants.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field></div>
        <div className="w-64"><Field label="Search name or asset code"><Input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></Field></div>
      </div>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <LoadingBlock /> : list.data && list.data.totalCount === 0 ? (
        <EmptyState title="No equipment found" action={isAdmin ? <Button onClick={() => setEditing('new')}>Add equipment</Button> : undefined}>
          Equipment needs a plant, a line and a category first. Create those, then add machines here.
        </EmptyState>
      ) : (
        <>
          <DataTable caption="Equipment" rows={list.data?.items ?? []} rowKey={(e) => e.id} columns={[
            { header: 'Asset code', cell: (e) => e.assetCode }, { header: 'Name', cell: (e) => e.name },
            { header: 'Plant / line', cell: (e) => `${e.plantName} / ${e.lineName}` }, { header: 'Category', cell: (e) => e.categoryName },
            { header: 'Ideal rate (units/h)', align: 'right', cell: (e) => formatNumber(e.idealRatePerHour) },
            { header: 'Status', cell: (e) => <Badge tone={tone(e.status)}>{e.status}</Badge> },
            ...(isAdmin ? [{ header: 'Actions', cell: (e: Equipment) => (
              <span className="flex gap-1">
                <Button variant="ghost" aria-label={`Edit ${e.assetCode}`} onClick={() => setEditing(e)}>Edit</Button>
                <Button variant="ghost" aria-label={`Delete ${e.assetCode}`} onClick={() => { del.clear(); setDeleting(e); }}>Delete</Button>
              </span>) }] : []),
          ]} />
          {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} totalCount={list.data.totalCount} onPage={setPage} />}
        </>
      )}
      {editing && <Modal title={editing === 'new' ? 'Add equipment' : 'Edit equipment'} onClose={() => setEditing(null)}>
        <EquipmentForm item={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); list.reload(); }} /></Modal>}
      {cats && <Modal title="Equipment categories" onClose={() => setCats(false)}><CategoryManager onChanged={list.reload} /></Modal>}
      {deleting && <ConfirmDialog title="Delete equipment" confirmLabel="Delete equipment" busy={del.busy} error={del.error}
        message={`Delete ${deleting.assetCode} (${deleting.name})? This is blocked if it has production or downtime history. Set it to Inactive instead.`}
        onConfirm={confirmDelete} onCancel={() => setDeleting(null)} />}
      <Card className="mt-5" title="About ideal rate"><p className="text-sm text-muted">Ideal rate is stored for reference. V1 does not use it in any KPI.</p></Card>
    </>
  );
}
