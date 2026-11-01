import { useRef, useState, type FormEvent } from 'react';
import { imports as importsApi } from '../api/endpoints';
import type { ConflictPolicy, ImportBatch, ImportKind, ImportResult, ImportRowError } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useAsync } from '../lib/useAsync';
import { formatDateTime, formatNumber } from '../lib/format';
import {
  Badge, Banner, Button, Card, DataTable, EmptyState, ErrorState, Field, FormError, LoadingBlock, Modal, PageHeader, Pagination, Select,
} from '../components/ui';

const PAGE_SIZE = 10;

const GUIDE: Record<ImportKind, Array<[string, string]>> = {
  production: [
    ['plant_code, line_code, asset_code', 'Identify the machine. An asset code is only unique within a line, so all three are needed.'],
    ['shift_name, shift_date', 'Shift as named in the plant; date as 2026-03-01 or 01/03/2026 (day first).'],
    ['units_produced, target_units, run_minutes', 'Whole numbers, not negative. Run minutes cannot exceed the shift length.'],
    ['inspected_units, rejected_units (optional)', 'Give both or neither; rejected cannot exceed inspected.'],
    ['defect_type, notes (optional)', 'Free text.'],
  ],
  downtime: [
    ['plant_code, line_code, asset_code', 'Identify the machine.'],
    ['start_time, end_time', 'ISO 8601 (2026-03-01T08:30:00Z) or 01/03/2026 08:30. Times without a zone are read as UTC. End must be after start, within 7 days.'],
    ['category', 'Planned or Unplanned.'],
    ['reason_code', 'Letters, digits, hyphen or underscore, up to 40 characters.'],
    ['notes (optional)', 'Free text.'],
  ],
};

const statusTone = (status: string) => (status === 'Completed' ? 'ok' : status === 'Rejected' ? 'warn' : 'danger') as 'ok' | 'warn' | 'danger';

export function ImportsPage() {
  const { isAdmin } = useAuth();
  const [page, setPage] = useState(1);
  const history = useAsync((s) => importsApi.list({ page, pageSize: PAGE_SIZE }, s), [page]);
  const [viewing, setViewing] = useState<ImportBatch | null>(null);

  return (
    <>
      <PageHeader
        title="Data imports"
        description="Load production and downtime records from CSV or Excel. Every file is checked row by row; valid rows are loaded together or not at all, and every attempt is kept in the history below."
      />
      {isAdmin ? (
        <UploadCard onDone={() => { setPage(1); history.reload(); }} />
      ) : (
        <Banner tone="info">Only administrators can upload files. You can still see the import history below.</Banner>
      )}

      <Card title="Import history" className="mt-6">
        {history.error ? <ErrorState error={history.error} onRetry={history.reload} /> : history.loading && !history.data ? <LoadingBlock /> : null}
        {history.data && history.data.items.length === 0 && <EmptyState title="No imports yet">Uploaded files and their results will be listed here.</EmptyState>}
        {history.data && history.data.items.length > 0 && (
          <>
            <DataTable<ImportBatch>
              caption="Import history"
              rows={history.data.items}
              rowKey={(b) => b.id}
              columns={[
                { header: 'When', cell: (b) => formatDateTime(b.startedAt) },
                { header: 'File', cell: (b) => <span title={b.message ?? undefined}>{b.fileName}</span> },
                { header: 'Type', cell: (b) => b.kind },
                { header: 'Status', cell: (b) => <Badge tone={statusTone(b.status)}>{b.status}</Badge> },
                { header: 'Rows', align: 'right', cell: (b) => formatNumber(b.totalRows) },
                { header: 'Added', align: 'right', cell: (b) => formatNumber(b.insertedRows) },
                { header: 'Updated', align: 'right', cell: (b) => formatNumber(b.updatedRows) },
                { header: 'Skipped', align: 'right', cell: (b) => formatNumber(b.skippedRows) },
                { header: 'Rejected', align: 'right', cell: (b) => formatNumber(b.rejectedRows) },
                { header: 'By', cell: (b) => b.uploadedBy ?? '—' },
                {
                  header: 'Problems',
                  cell: (b) => (b.rejectedRows > 0 || b.status !== 'Completed'
                    ? <Button variant="ghost" onClick={() => setViewing(b)} aria-label={`View problems for ${b.fileName}`}>View</Button>
                    : '—'),
                },
              ]}
            />
            <Pagination page={page} pageSize={PAGE_SIZE} totalCount={history.data.totalCount} onPage={setPage} />
          </>
        )}
      </Card>
      {viewing && <ErrorsModal batch={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function UploadCard({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<ImportKind>('production');
  const [policy, setPolicy] = useState<ConflictPolicy>('skip');
  const [strict, setStrict] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<ImportResult | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(undefined);
    setResult(null);
    try {
      setResult(await importsApi.upload({ file, kind, conflictPolicy: policy, strict }));
      setFile(null);
      if (input.current) input.current.value = '';
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Upload a file">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-4" aria-label="Upload file">
        <Field label="What is in the file?">
          <Select value={kind} onChange={(e) => setKind(e.target.value as ImportKind)}>
            <option value="production">Production records</option>
            <option value="downtime">Downtime events</option>
          </Select>
        </Field>
        <Field label="If a record already exists" hint={policy === 'skip' ? 'Existing records are left unchanged.' : 'Existing records are overwritten with the file values.'}>
          <Select value={policy} onChange={(e) => setPolicy(e.target.value as ConflictPolicy)}>
            <option value="skip">Skip it</option>
            <option value="update">Update it</option>
          </Select>
        </Field>
        <div className="md:col-span-2">
          <Field label="File (.csv or .xlsx, up to 10 MB)">
            <input ref={input} type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded border border-line bg-white px-2.5 py-1.5 text-sm" />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm md:col-span-3">
          <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} className="mt-0.5" />
          <span>Reject the whole file if any row is invalid <span className="text-muted">(otherwise valid rows load and invalid rows are reported)</span></span>
        </label>
        <div className="flex items-end justify-end">
          <Button type="submit" busy={busy} disabled={!file}>Upload and check</Button>
        </div>
      </form>

      <p className="mt-3 text-sm">
        Not sure of the layout? Download the <a className="text-accent underline" href={importsApi.templateUrl(kind)} download>{kind} template</a> (header row only).
      </p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-medium">Columns and rules for {kind} files</summary>
        <dl className="mt-2 space-y-1">
          {GUIDE[kind].map(([name, rule]) => (
            <div key={name} className="grid gap-x-3 md:grid-cols-[18rem_1fr]"><dt className="font-mono text-xs">{name}</dt><dd className="text-muted">{rule}</dd></div>
          ))}
        </dl>
      </details>

      <div className="mt-3 space-y-3">
        <FormError error={error} />
        {result && <ResultPanel result={result} />}
      </div>
    </Card>
  );
}

function ResultPanel({ result }: { result: ImportResult }) {
  const tone = result.status === 'Completed' ? (result.rejectedRows > 0 ? 'warn' : 'success') : 'error';
  return (
    <div className="space-y-2" data-testid="import-result">
      <Banner tone={tone}>
        <strong>{result.status === 'Completed' ? 'Import finished' : result.status === 'Rejected' ? 'File rejected' : 'Import failed'}.</strong> {result.message}
        {result.alreadyImported && <span className="block">This exact file was already imported, so nothing was loaded again.</span>}
      </Banner>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        {([['Rows read', result.totalRows], ['Added', result.insertedRows], ['Updated', result.updatedRows], ['Skipped', result.skippedRows], ['Rejected', result.rejectedRows]] as const).map(([label, value]) => (
          <div key={label} className="rounded border border-line p-2"><dt className="text-xs text-muted">{label}</dt><dd className="text-lg font-semibold">{formatNumber(value)}</dd></div>
        ))}
      </dl>
      {result.warnings.length > 0 && <ul className="list-disc pl-5 text-sm">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {result.errorsPreview.length > 0 && (
        <>
          <ErrorTable errors={result.errorsPreview} caption="First problems found" />
          {result.errorsTruncated && <p className="text-xs text-muted">Only the first problems were stored; fix these and upload again to see the rest.</p>}
        </>
      )}
    </div>
  );
}

function ErrorTable({ errors, caption }: { errors: ImportRowError[]; caption: string }) {
  return (
    <DataTable<ImportRowError>
      caption={caption}
      rows={errors}
      rowKey={(e) => `${e.rowNumber}-${e.column ?? ''}-${e.code}`}
      columns={[
        { header: 'Row', align: 'right', cell: (e) => (e.rowNumber === 0 ? 'File' : e.rowNumber) },
        { header: 'Column', cell: (e) => e.column ?? '—' },
        { header: 'Problem', cell: (e) => <span className="block max-w-md whitespace-normal">{e.message}</span> },
        { header: 'Value', cell: (e) => <span className="font-mono text-xs">{e.rawValue ?? '—'}</span> },
      ]}
    />
  );
}

function ErrorsModal({ batch, onClose }: { batch: ImportBatch; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const errors = useAsync((s) => importsApi.errors(batch.id, { page, pageSize: 50 }, s), [batch.id, page]);
  return (
    <Modal title={`Problems in ${batch.fileName}`} onClose={onClose}>
      {batch.message && <p className="mb-2 text-sm">{batch.message}</p>}
      {errors.error ? <ErrorState error={errors.error} onRetry={errors.reload} /> : errors.loading && !errors.data ? <LoadingBlock /> : null}
      {errors.data && errors.data.items.length === 0 && <p className="text-sm text-muted">No row-level problems were stored for this file.</p>}
      {errors.data && errors.data.items.length > 0 && (
        <>
          <ErrorTable errors={errors.data.items} caption="Problems found in this file" />
          <Pagination page={page} pageSize={50} totalCount={errors.data.totalCount} onPage={setPage} />
          {batch.errorsTruncated && <p className="mt-2 text-xs text-muted">The list was capped when the file was processed.</p>}
        </>
      )}
    </Modal>
  );
}
