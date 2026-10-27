import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { lines as linesApi, plants as plantsApi, shifts as shiftsApi, type PlantInput } from '../api/endpoints';
import type { Line, Plant, Shift } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { useSubmit } from '../lib/useSubmit';
import { useAuth } from '../auth/AuthContext';
import { formatNumber, formatTime } from '../lib/format';
import {
  Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, FormError, Input, LoadingBlock, Modal, PageHeader,
} from '../components/ui';

function PlantForm({ plant, onDone, onCancel }: { plant?: Plant; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<PlantInput>({
    name: plant?.name ?? '', code: plant?.code ?? '', location: plant?.location ?? '', timeZone: plant?.timeZone ?? 'Europe/London',
  });
  const s = useSubmit();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { ...form, location: form.location?.trim() || null };
    const r = await s.run(() => (plant ? plantsApi.update(plant.id, body) : plantsApi.create(body)));
    if (r.ok) onDone();
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormError error={s.error} />
      <Field label="Plant name" error={s.fieldError('name')}><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Code" hint="Letters, numbers, hyphen, underscore." error={s.fieldError('code')}><Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
      <Field label="Location (optional)" error={s.fieldError('location')}><Input value={form.location ?? ''} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
      <Field label="Time zone" hint="IANA name, for example Europe/London." error={s.fieldError('timeZone')}><Input required value={form.timeZone} onChange={(e) => setForm({ ...form, timeZone: e.target.value })} /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" busy={s.busy}>{plant ? 'Save changes' : 'Create plant'}</Button>
      </div>
    </form>
  );
}

export function PlantsPage() {
  const { isAdmin } = useAuth();
  const list = useAsync(() => plantsApi.list(), []);
  const [editing, setEditing] = useState<Plant | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Plant | null>(null);
  const del = useSubmit();

  async function confirmDelete() {
    if (!deleting) return;
    const r = await del.run(() => plantsApi.remove(deleting.id));
    if (r.ok) { setDeleting(null); list.reload(); }
  }

  return (
    <>
      <PageHeader
        title="Plants"
        description="Each plant has production lines, shifts and equipment."
        actions={isAdmin ? <Button onClick={() => setEditing('new')}>Add plant</Button> : undefined}
      />
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <LoadingBlock /> : list.data && list.data.length === 0 ? (
        <EmptyState title="No plants yet" action={isAdmin ? <Button onClick={() => setEditing('new')}>Add your first plant</Button> : undefined}>
          A plant is a site. Add one, then give it shifts and production lines.
        </EmptyState>
      ) : (
        <DataTable
          caption="Plants"
          rows={list.data ?? []}
          rowKey={(p) => p.id}
          columns={[
            { header: 'Plant', cell: (p) => <Link className="text-accent underline" to={`/plants/${p.id}`}>{p.name}</Link> },
            { header: 'Code', cell: (p) => p.code },
            { header: 'Location', cell: (p) => p.location ?? '—' },
            { header: 'Lines', align: 'right', cell: (p) => formatNumber(p.lineCount) },
            { header: 'Shifts', align: 'right', cell: (p) => formatNumber(p.shiftCount) },
            { header: 'Equipment', align: 'right', cell: (p) => formatNumber(p.equipmentCount) },
            ...(isAdmin ? [{
              header: 'Actions',
              cell: (p: Plant) => (
                <span className="flex gap-1">
                  <Button variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>Edit</Button>
                  <Button variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => { del.clear(); setDeleting(p); }}>Delete</Button>
                </span>
              ),
            }] : []),
          ]}
        />
      )}
      {editing && (
        <Modal title={editing === 'new' ? 'Add plant' : 'Edit plant'} onClose={() => setEditing(null)}>
          <PlantForm plant={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); list.reload(); }} />
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete plant" confirmLabel="Delete plant" busy={del.busy} error={del.error}
          message={`Delete ${deleting.name}? This is blocked if it still has lines, shifts or equipment.`}
          onConfirm={confirmDelete} onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function LineForm({ plantId, line, onDone, onCancel }: { plantId: string; line?: Line; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(line?.name ?? '');
  const [code, setCode] = useState(line?.code ?? '');
  const s = useSubmit();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { plantId, name, code };
    const r = await s.run(() => (line ? linesApi.update(line.id, body) : linesApi.create(body)));
    if (r.ok) onDone();
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormError error={s.error} />
      <Field label="Line name" error={s.fieldError('name')}><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Code" error={s.fieldError('code')}><Input required value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" busy={s.busy}>{line ? 'Save changes' : 'Add line'}</Button>
      </div>
    </form>
  );
}

function ShiftForm({ plantId, shift, onDone, onCancel }: { plantId: string; shift?: Shift; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(shift?.name ?? '');
  const [start, setStart] = useState(shift ? formatTime(shift.startTime) : '06:00');
  const [end, setEnd] = useState(shift ? formatTime(shift.endTime) : '14:00');
  const s = useSubmit();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { plantId, name, startTime: `${start}:00`, endTime: `${end}:00` };
    const r = await s.run(() => (shift ? shiftsApi.update(shift.id, body) : shiftsApi.create(body)));
    if (r.ok) onDone();
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormError error={s.error} />
      <Field label="Shift name" error={s.fieldError('name')}><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start" error={s.fieldError('startTime')}><Input type="time" required value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="End" hint="An end before the start means the shift runs past midnight." error={s.fieldError('endTime')}><Input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" busy={s.busy}>{shift ? 'Save changes' : 'Add shift'}</Button>
      </div>
    </form>
  );
}

export function PlantDetailPage() {
  const { plantId = '' } = useParams();
  const { isAdmin } = useAuth();
  const plant = useAsync(() => plantsApi.get(plantId), [plantId]);
  const lines = useAsync(() => linesApi.list(plantId), [plantId]);
  const shifts = useAsync(() => shiftsApi.list(plantId), [plantId]);
  const [lineEdit, setLineEdit] = useState<Line | 'new' | null>(null);
  const [shiftEdit, setShiftEdit] = useState<Shift | 'new' | null>(null);
  const [del, setDel] = useState<{ kind: 'line' | 'shift'; id: string; name: string } | null>(null);
  const d = useSubmit();

  async function confirmDelete() {
    if (!del) return;
    const r = await d.run(() => (del.kind === 'line' ? linesApi.remove(del.id) : shiftsApi.remove(del.id)));
    if (r.ok) { setDel(null); lines.reload(); shifts.reload(); plant.reload(); }
  }
  const refresh = () => { lines.reload(); shifts.reload(); plant.reload(); };

  if (plant.error) return <ErrorState error={plant.error} onRetry={plant.reload} />;
  if (!plant.data) return <LoadingBlock />;

  return (
    <>
      <p className="mb-2 text-sm"><Link className="text-accent underline" to="/plants">← All plants</Link></p>
      <PageHeader title={plant.data.name} description={`${plant.data.code}${plant.data.location ? ` · ${plant.data.location}` : ''} · ${plant.data.timeZone}`} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Production lines" actions={isAdmin ? <Button variant="secondary" onClick={() => setLineEdit('new')}>Add line</Button> : undefined}>
          {lines.error ? <ErrorState error={lines.error} onRetry={lines.reload} /> : (lines.data ?? []).length === 0 ? (
            <EmptyState title="No lines yet">Equipment is attached to a line, so add a line before adding equipment.</EmptyState>
          ) : (
            <DataTable caption="Production lines" rows={lines.data ?? []} rowKey={(l) => l.id} columns={[
              { header: 'Line', cell: (l) => l.name }, { header: 'Code', cell: (l) => l.code },
              { header: 'Equipment', align: 'right', cell: (l) => formatNumber(l.equipmentCount) },
              ...(isAdmin ? [{ header: 'Actions', cell: (l: Line) => (
                <span className="flex gap-1">
                  <Button variant="ghost" aria-label={`Edit ${l.name}`} onClick={() => setLineEdit(l)}>Edit</Button>
                  <Button variant="ghost" aria-label={`Delete ${l.name}`} onClick={() => { d.clear(); setDel({ kind: 'line', id: l.id, name: l.name }); }}>Delete</Button>
                </span>) }] : []),
            ]} />
          )}
        </Card>
        <Card title="Shifts" actions={isAdmin ? <Button variant="secondary" onClick={() => setShiftEdit('new')}>Add shift</Button> : undefined}>
          {shifts.error ? <ErrorState error={shifts.error} onRetry={shifts.reload} /> : (shifts.data ?? []).length === 0 ? (
            <EmptyState title="No shifts yet">Production records are entered against a shift.</EmptyState>
          ) : (
            <DataTable caption="Shifts" rows={shifts.data ?? []} rowKey={(x) => x.id} columns={[
              { header: 'Shift', cell: (x) => x.name },
              { header: 'Time', cell: (x) => `${formatTime(x.startTime)}–${formatTime(x.endTime)}` },
              { header: 'Minutes', align: 'right', cell: (x) => formatNumber(x.durationMinutes) },
              ...(isAdmin ? [{ header: 'Actions', cell: (x: Shift) => (
                <span className="flex gap-1">
                  <Button variant="ghost" aria-label={`Edit ${x.name}`} onClick={() => setShiftEdit(x)}>Edit</Button>
                  <Button variant="ghost" aria-label={`Delete ${x.name}`} onClick={() => { d.clear(); setDel({ kind: 'shift', id: x.id, name: x.name }); }}>Delete</Button>
                </span>) }] : []),
            ]} />
          )}
        </Card>
      </div>
      {lineEdit && <Modal title={lineEdit === 'new' ? 'Add line' : 'Edit line'} onClose={() => setLineEdit(null)}>
        <LineForm plantId={plantId} line={lineEdit === 'new' ? undefined : lineEdit} onCancel={() => setLineEdit(null)} onDone={() => { setLineEdit(null); refresh(); }} />
      </Modal>}
      {shiftEdit && <Modal title={shiftEdit === 'new' ? 'Add shift' : 'Edit shift'} onClose={() => setShiftEdit(null)}>
        <ShiftForm plantId={plantId} shift={shiftEdit === 'new' ? undefined : shiftEdit} onCancel={() => setShiftEdit(null)} onDone={() => { setShiftEdit(null); refresh(); }} />
      </Modal>}
      {del && <ConfirmDialog title={`Delete ${del.kind}`} confirmLabel={`Delete ${del.kind}`} busy={d.busy} error={d.error}
        message={`Delete ${del.name}? This is blocked if equipment or production history refers to it.`} onConfirm={confirmDelete} onCancel={() => setDel(null)} />}
    </>
  );
}
