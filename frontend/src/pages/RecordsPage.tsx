import { useState, type FormEvent } from 'react';
import { downtime as dtApi, equipment as eqApi, production as prodApi, shifts as shiftApi } from '../api/endpoints';
import type { DowntimeCategory, DowntimeEvent, Equipment, ProductionRecord, Shift } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { useSubmit } from '../lib/useSubmit';
import { useAuth } from '../auth/AuthContext';
import { formatDate, formatDateTime, formatMinutes, formatNumber, toIsoDate } from '../lib/format';
import {
  Badge, Banner, Button, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, FormError, Input, LoadingBlock, Modal, PageHeader, Pagination, Select, Textarea,
} from '../components/ui';

function useEquipmentOptions() {
  return useAsync(() => eqApi.list({ pageSize: 200 }), []);
}

function ProductionForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const eq = useEquipmentOptions();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [f, setF] = useState({
    equipmentId: '', shiftId: '', shiftDate: toIsoDate(new Date()), unitsProduced: '', targetUnits: '', runMinutes: '',
    inspectedUnits: '', rejectedUnits: '', defectType: '', notes: '',
  });
  const s = useSubmit();
  const selected: Equipment | undefined = eq.data?.items.find((e) => e.id === f.equipmentId);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function pickEquipment(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setF({ ...f, equipmentId: id, shiftId: '' });
    const item = eq.data?.items.find((x) => x.id === id);
    setShifts(item ? await shiftApi.list(item.plantId) : []);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const num = (v: string) => (v === '' ? null : Number(v));
    const r = await s.run(() => prodApi.create({
      equipmentId: f.equipmentId, shiftId: f.shiftId, shiftDate: f.shiftDate,
      unitsProduced: Number(f.unitsProduced), targetUnits: Number(f.targetUnits), runMinutes: Number(f.runMinutes),
      inspectedUnits: num(f.inspectedUnits), rejectedUnits: num(f.rejectedUnits),
      defectType: f.defectType.trim() || null, notes: f.notes.trim() || null,
    }));
    if (r.ok) onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormError error={s.error} />
      <Field label="Equipment" error={s.fieldError('equipmentId')}>
        <Select required value={f.equipmentId} onChange={pickEquipment}>
          <option value="">Select equipment</option>
          {(eq.data?.items ?? []).filter((e) => e.status !== 'Inactive').map((e) => <option key={e.id} value={e.id}>{e.assetCode} – {e.name} ({e.plantName})</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Shift" hint={selected ? undefined : 'Choose equipment first.'} error={s.fieldError('shiftId')}>
          <Select required value={f.shiftId} onChange={set('shiftId')} disabled={!selected}>
            <option value="">Select a shift</option>
            {shifts.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.durationMinutes} min)</option>)}
          </Select>
        </Field>
        <Field label="Shift date" error={s.fieldError('shiftDate')}><Input type="date" required value={f.shiftDate} onChange={set('shiftDate')} /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Units produced" error={s.fieldError('unitsProduced')}><Input type="number" min="0" required value={f.unitsProduced} onChange={set('unitsProduced')} /></Field>
        <Field label="Target units" error={s.fieldError('targetUnits')}><Input type="number" min="0" required value={f.targetUnits} onChange={set('targetUnits')} /></Field>
        <Field label="Run minutes" error={s.fieldError('runMinutes')}><Input type="number" min="0" max="1440" required value={f.runMinutes} onChange={set('runMinutes')} /></Field>
      </div>
      <fieldset className="rounded border border-line p-3">
        <legend className="px-1 text-sm font-medium">Quality (optional – enter both or neither)</legend>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Inspected" error={s.fieldError('inspectedUnits')}><Input type="number" min="0" value={f.inspectedUnits} onChange={set('inspectedUnits')} /></Field>
          <Field label="Rejected" error={s.fieldError('rejectedUnits')}><Input type="number" min="0" value={f.rejectedUnits} onChange={set('rejectedUnits')} /></Field>
          <Field label="Defect type" error={s.fieldError('defectType')}><Input value={f.defectType} onChange={set('defectType')} /></Field>
        </div>
      </fieldset>
      <Field label="Notes (optional)" error={s.fieldError('notes')}><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" busy={s.busy}>Save record</Button>
      </div>
    </form>
  );
}

function DowntimeForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const eq = useEquipmentOptions();
  const [f, setF] = useState({ equipmentId: '', start: '', end: '', category: 'Unplanned' as DowntimeCategory, reasonCode: '', notes: '' });
  const s = useSubmit();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    // datetime-local has no zone; the browser's local time is converted to an exact instant (UTC) before sending.
    const iso = (v: string) => (v ? new Date(v).toISOString() : '');
    const r = await s.run(() => dtApi.create({
      equipmentId: f.equipmentId, startTime: iso(f.start), endTime: iso(f.end), category: f.category,
      reasonCode: f.reasonCode.trim(), notes: f.notes.trim() || null,
    }));
    if (r.ok) onDone();
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormError error={s.error} />
      <Field label="Equipment" error={s.fieldError('equipmentId')}>
        <Select required value={f.equipmentId} onChange={set('equipmentId')}>
          <option value="">Select equipment</option>
          {(eq.data?.items ?? []).map((e) => <option key={e.id} value={e.id}>{e.assetCode} – {e.name} ({e.plantName})</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start" error={s.fieldError('startTime')}><Input type="datetime-local" required value={f.start} onChange={set('start')} /></Field>
        <Field label="End" error={s.fieldError('endTime')}><Input type="datetime-local" required value={f.end} onChange={set('end')} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" error={s.fieldError('category')}><Select value={f.category} onChange={set('category')}><option>Unplanned</option><option>Planned</option></Select></Field>
        <Field label="Reason code" hint="For example JAM, CHANGEOVER." error={s.fieldError('reasonCode')}><Input required value={f.reasonCode} onChange={set('reasonCode')} /></Field>
      </div>
      <Field label="Notes (optional)" error={s.fieldError('notes')}><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" busy={s.busy}>Save downtime</Button>
      </div>
    </form>
  );
}

export function RecordsPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<'production' | 'downtime'>('production');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [deleting, setDeleting] = useState<{ kind: 'production' | 'downtime'; id: string; label: string } | null>(null);
  const del = useSubmit();

  const prod = useAsync(() => (tab === 'production' ? prodApi.list({ page, pageSize: 20 }) : Promise.resolve(undefined)), [tab, page]);
  const down = useAsync(() => (tab === 'downtime' ? dtApi.list({ page, pageSize: 20 }) : Promise.resolve(undefined)), [tab, page]);
  const active = tab === 'production' ? prod : down;

  function switchTab(next: 'production' | 'downtime') { setTab(next); setPage(1); setNotice(undefined); }
  function saved() { setAdding(false); setNotice(tab === 'production' ? 'Production record saved.' : 'Downtime event saved.'); setPage(1); prod.reload(); down.reload(); }

  async function confirmDelete() {
    if (!deleting) return;
    const r = await del.run(() => (deleting.kind === 'production' ? prodApi.remove(deleting.id) : dtApi.remove(deleting.id)));
    if (r.ok) { setDeleting(null); setNotice('Deleted.'); active.reload(); }
  }

  const tabBtn = (id: 'production' | 'downtime', label: string) => (
    <button type="button" role="tab" aria-selected={tab === id} onClick={() => switchTab(id)}
      className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'}`}>{label}</button>
  );

  return (
    <>
      <PageHeader title="Production & downtime" description="Enter shift results and stoppages. The server checks each entry against the shift, equipment and existing records."
        actions={<Button onClick={() => { setNotice(undefined); setAdding(true); }}>{tab === 'production' ? 'Add production record' : 'Add downtime event'}</Button>} />
      <div role="tablist" aria-label="Record type" className="mb-4 flex border-b border-line">{tabBtn('production', 'Production records')}{tabBtn('downtime', 'Downtime events')}</div>
      {notice && <div className="mb-3"><Banner tone="success">{notice}</Banner></div>}

      {active.error ? <ErrorState error={active.error} onRetry={active.reload} /> : active.loading && !active.data ? <LoadingBlock /> : (
        tab === 'production' ? (
          prod.data && prod.data.totalCount === 0 ? <EmptyState title="No production records yet" action={<Button onClick={() => setAdding(true)}>Add the first record</Button>}>You need a plant, shift and equipment before entering production.</EmptyState> : prod.data && (
            <>
              <DataTable caption="Production records" rows={prod.data.items} rowKey={(r) => r.id} columns={[
                { header: 'Date', cell: (r: ProductionRecord) => formatDate(r.shiftDate) },
                { header: 'Equipment', cell: (r) => `${r.assetCode} – ${r.equipmentName}` },
                { header: 'Plant / line', cell: (r) => `${r.plantName} / ${r.lineName}` },
                { header: 'Shift', cell: (r) => r.shiftName },
                { header: 'Units', align: 'right', cell: (r) => formatNumber(r.unitsProduced) },
                { header: 'Target', align: 'right', cell: (r) => formatNumber(r.targetUnits) },
                { header: 'Run (min)', align: 'right', cell: (r) => formatNumber(r.runMinutes) },
                { header: 'Rejected / inspected', align: 'right', cell: (r) => (r.inspectedUnits === null ? '—' : `${r.rejectedUnits} / ${r.inspectedUnits}`) },
                ...(isAdmin ? [{ header: 'Actions', cell: (r: ProductionRecord) => <Button variant="ghost" aria-label={`Delete record ${r.assetCode} ${r.shiftDate}`} onClick={() => { del.clear(); setDeleting({ kind: 'production', id: r.id, label: `${r.assetCode} on ${formatDate(r.shiftDate)}` }); }}>Delete</Button> }] : []),
              ]} />
              <Pagination page={prod.data.page} pageSize={prod.data.pageSize} totalCount={prod.data.totalCount} onPage={setPage} />
            </>
          )
        ) : (
          down.data && down.data.totalCount === 0 ? <EmptyState title="No downtime events yet" action={<Button onClick={() => setAdding(true)}>Add downtime</Button>}>Record stoppages to see availability and the downtime breakdown.</EmptyState> : down.data && (
            <>
              <DataTable caption="Downtime events" rows={down.data.items} rowKey={(r) => r.id} columns={[
                { header: 'Start', cell: (r: DowntimeEvent) => formatDateTime(r.startTime + (r.startTime.endsWith('Z') ? '' : 'Z')) },
                { header: 'Equipment', cell: (r) => `${r.assetCode} – ${r.equipmentName}` },
                { header: 'Plant', cell: (r) => r.plantName },
                { header: 'Category', cell: (r) => <Badge tone={r.category === 'Unplanned' ? 'warn' : 'neutral'}>{r.category}</Badge> },
                { header: 'Reason', cell: (r) => r.reasonCode },
                { header: 'Duration', align: 'right', cell: (r) => formatMinutes(r.durationMinutes) },
                ...(isAdmin ? [{ header: 'Actions', cell: (r: DowntimeEvent) => <Button variant="ghost" aria-label={`Delete downtime ${r.assetCode} ${r.reasonCode}`} onClick={() => { del.clear(); setDeleting({ kind: 'downtime', id: r.id, label: `${r.reasonCode} on ${r.assetCode}` }); }}>Delete</Button> }] : []),
              ]} />
              <Pagination page={down.data.page} pageSize={down.data.pageSize} totalCount={down.data.totalCount} onPage={setPage} />
            </>
          )
        )
      )}

      {adding && <Modal title={tab === 'production' ? 'Add production record' : 'Add downtime event'} onClose={() => setAdding(false)}>
        {tab === 'production' ? <ProductionForm onCancel={() => setAdding(false)} onDone={saved} /> : <DowntimeForm onCancel={() => setAdding(false)} onDone={saved} />}
      </Modal>}
      {deleting && <ConfirmDialog title="Delete entry" confirmLabel="Delete" busy={del.busy} error={del.error}
        message={`Delete ${deleting.label}? This changes the KPIs for that period.`} onConfirm={confirmDelete} onCancel={() => setDeleting(null)} />}
    </>
  );
}
