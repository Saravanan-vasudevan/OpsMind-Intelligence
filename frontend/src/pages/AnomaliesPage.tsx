import { useState } from 'react';
import { intelligence, plants as plantsApi } from '../api/endpoints';
import type { Anomaly, AnomalyMethod } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { daysAgo, formatDate, formatNumber } from '../lib/format';
import { Banner, Badge, Button, Card, DataTable, EmptyState, ErrorState, Field, Input, LoadingBlock, PageHeader, Select } from '../components/ui';

const METRIC_LABEL: Record<string, string> = { attainment: 'Target attainment', defect_rate: 'Defect rate', downtime_share: 'Unplanned downtime (7 days)' };
const METHOD_LABEL: Record<AnomalyMethod, string> = {
  robust_z: 'Robust z-score (same weekday, own history)',
  isolation_forest: 'Isolation forest (multi-metric)',
};

export function AnomaliesPage() {
  const [from, setFrom] = useState(() => daysAgo(30));
  const [to, setTo] = useState(() => daysAgo(1));
  const [plantId, setPlantId] = useState('');
  const [method, setMethod] = useState<AnomalyMethod>('robust_z');
  const [showEvaluation, setShowEvaluation] = useState(false);

  const plantList = useAsync(() => plantsApi.list(), []);
  const result = useAsync(
    (s) => intelligence.anomalies({ from, to, method, plantId: plantId || undefined }, s),
    [from, to, method, plantId],
  );

  return (
    <>
      <PageHeader
        title="Anomalies"
        description="Machine-days that look unusual compared with the same machine's own recent history. A flag is a prompt to go and look, not a diagnosis."
      />
      <form className="mb-5 flex flex-wrap items-end gap-3 rounded border border-line bg-white p-3" onSubmit={(e) => e.preventDefault()} aria-label="Anomaly options">
        <div className="w-40"><Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field></div>
        <div className="w-40"><Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field></div>
        <div className="w-52">
          <Field label="Plant">
            <Select value={plantId} onChange={(e) => setPlantId(e.target.value)}>
              <option value="">All plants</option>
              {(plantList.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="w-72">
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as AnomalyMethod)}>
              {(Object.keys(METHOD_LABEL) as AnomalyMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
            </Select>
          </Field>
        </div>
      </form>

      {result.error && <ErrorState error={result.error} onRetry={result.reload} />}
      {result.loading && !result.data && <LoadingBlock label="Checking machine-days" />}

      {result.data && (
        <div className={result.loading ? 'opacity-60' : undefined}>
          <p className="mb-3 text-sm" data-testid="anomaly-summary">
            {result.data.totalFlags === 0
              ? `No machine-days flagged out of ${formatNumber(result.data.machineDaysEvaluated)} checked.`
              : `${formatNumber(result.data.totalFlags)} flag${result.data.totalFlags === 1 ? '' : 's'} across ${formatNumber(result.data.machineDaysEvaluated)} machine-days checked${result.data.returned < result.data.totalFlags ? ` (showing the ${result.data.returned} strongest)` : ''}.`}
          </p>
          {result.data.totalFlags === 0 ? (
            <EmptyState title="Nothing unusual in this period">
              That is not proof that nothing went wrong: the method only compares each machine with its own recent pattern, and needs several weeks of history before it flags anything.
            </EmptyState>
          ) : (
            <DataTable<Anomaly>
              caption="Flagged machine-days"
              rows={result.data.anomalies}
              rowKey={(a) => `${a.equipmentId}-${a.date}-${a.metric}`}
              columns={[
                { header: 'Date', cell: (a) => formatDate(a.date) },
                { header: 'Machine', cell: (a) => a.assetCode },
                { header: 'Measure', cell: (a) => <Badge tone="warn">{METRIC_LABEL[a.metric] ?? a.metric}</Badge> },
                { header: 'Score', align: 'right', cell: (a) => a.score.toFixed(1) },
                { header: 'Why it was flagged', cell: (a) => <span className="block max-w-xl whitespace-normal">{a.explanation}</span> },
              ]}
            />
          )}
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
            {result.data.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      )}

      <Card
        title="How well does this work?"
        className="mt-6"
        actions={<Button variant="secondary" aria-expanded={showEvaluation} onClick={() => setShowEvaluation((v) => !v)}>{showEvaluation ? 'Hide' : 'Show evaluation'}</Button>}
      >
        <p className="text-sm text-muted">
          Measured on generated data where known problems were planted, so the true answer is known. It says how the method behaves on data like that, not how it will perform on yours.
        </p>
        {showEvaluation && <Evaluation />}
      </Card>
    </>
  );
}

function Evaluation() {
  const evaluation = useAsync((s) => intelligence.evaluation(s), []);
  if (evaluation.error) return <div className="mt-3"><ErrorState error={evaluation.error} onRetry={evaluation.reload} /></div>;
  if (!evaluation.data) return <LoadingBlock label="Running benchmark" />;
  const e = evaluation.data;
  const pct = (v: unknown) => (typeof v === 'number' ? `${(v * 100).toFixed(0)}%` : '—');
  const rows = Object.entries(e.detectors).map(([name, d]) => ({ name, d }));
  return (
    <div className="mt-3 space-y-3">
      <Banner tone="warn">
        <strong>Synthetic benchmark.</strong> {e.dataset.machines} machines, {e.dataset.days} days, {e.dataset.injectedAnomalies} planted problems ({e.dataset.evaluatedMachineDays.toLocaleString('en-GB')} machine-days scored).
      </Banner>
      <DataTable
        caption="Detector performance on the synthetic benchmark"
        rows={rows}
        rowKey={(r) => r.name}
        columns={[
          { header: 'Method', cell: (r) => METHOD_LABEL[r.name as AnomalyMethod] ?? r.name },
          { header: 'Planted problems found', align: 'right', cell: (r) => `${r.d.injectedFound} of ${Number(r.d.injectedFound) + Number(r.d.injectedMissed)} (${pct(r.d.recall)})` },
          { header: 'Flags that were real', align: 'right', cell: (r) => pct(r.d.precision) },
          { header: 'False alarms per 1,000 machine-days', align: 'right', cell: (r) => String(r.d.falseAlarmsPer1000MachineDays ?? '—') },
          { header: 'Flags on the same data with nothing planted', align: 'right', cell: (r) => String(r.d.flagsOnCleanData ?? '—') },
        ]}
      />
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
        {e.limitations.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </div>
  );
}
