import { useState } from 'react';
import { equipment as equipmentApi, intelligence, plants as plantsApi } from '../api/endpoints';
import type { ForecastMetric } from '../api/types';
import { ApiError } from '../api/client';
import { useAsync } from '../lib/useAsync';
import { formatNumber, formatPercent } from '../lib/format';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Field, LoadingBlock, PageHeader, Select } from '../components/ui';
import { ForecastChart, ForecastTable } from '../charts/IntelligenceCharts';

const METRICS: Record<ForecastMetric, string> = { units: 'Units produced per day', unplanned_downtime_minutes: 'Unplanned downtime minutes per day' };

export function ForecastPage() {
  const [metric, setMetric] = useState<ForecastMetric>('units');
  const [horizon, setHorizon] = useState(14);
  const [plantId, setPlantId] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [showTable, setShowTable] = useState(false);

  const plantList = useAsync(() => plantsApi.list(), []);
  const machines = useAsync(() => (plantId ? equipmentApi.list({ plantId, pageSize: 200 }) : Promise.resolve(undefined)), [plantId]);
  const forecast = useAsync(
    (s) => intelligence.forecast({ metric, horizon, plantId: plantId || undefined, equipmentId: equipmentId || undefined }, s),
    [metric, horizon, plantId, equipmentId],
  );

  const data = forecast.data;
  return (
    <>
      <PageHeader
        title="Forecast"
        description="Daily forecasts from your stored records. Each model is scored on rolling-origin backtests of your own history; the best one is used. Nothing here is a fixed or invented number."
      />
      <form className="mb-5 flex flex-wrap items-end gap-3 rounded border border-line bg-white p-3" onSubmit={(e) => e.preventDefault()} aria-label="Forecast options">
        <div className="w-60">
          <Field label="Measure">
            <Select value={metric} onChange={(e) => setMetric(e.target.value as ForecastMetric)}>
              {Object.entries(METRICS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </Select>
          </Field>
        </div>
        <div className="w-36">
          <Field label="Days ahead">
            <Select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
              {[7, 14, 28].map((d) => <option key={d} value={d}>{d} days</option>)}
            </Select>
          </Field>
        </div>
        <div className="w-52">
          <Field label="Plant">
            <Select value={plantId} onChange={(e) => { setPlantId(e.target.value); setEquipmentId(''); }}>
              <option value="">All plants</option>
              {(plantList.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="w-52">
          <Field label="Machine" hint={plantId ? undefined : 'Choose a plant to pick a machine'}>
            <Select value={equipmentId} disabled={!plantId} onChange={(e) => setEquipmentId(e.target.value)}>
              <option value="">All machines</option>
              {(machines.data?.items ?? []).map((m) => <option key={m.id} value={m.id}>{m.assetCode}</option>)}
            </Select>
          </Field>
        </div>
      </form>

      {forecast.loading && !data && <LoadingBlock label="Backtesting models" />}
      {forecast.error && <ForecastProblem error={forecast.error} onRetry={forecast.reload} />}

      {data && (
        <div className={forecast.loading ? 'opacity-60' : undefined}>
          <Card
            title={`${METRICS[data.metric]} — ${data.scope.assetCode ?? data.scope.plantName ?? 'all plants'}`}
            actions={<Button variant="ghost" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>{showTable ? 'Show chart' : 'Show as table'}</Button>}
          >
            {showTable ? <ForecastTable forecast={data} /> : <ForecastChart forecast={data} valueLabel={METRICS[data.metric]} />}
            <p className="mt-2 text-sm">
              Model chosen: <strong>{data.selectedModel.replace(/_/g, ' ')}</strong> — {data.selectedModelDescription}
            </p>
          </Card>

          <Card title="How the models scored on your history" className="mt-5">
            <DataTable
              caption="Backtest results by model"
              rows={data.backtest.models}
              rowKey={(m) => m.name}
              columns={[
                { header: 'Model', cell: (m) => <span>{m.name.replace(/_/g, ' ')} {m.selected && <Badge tone="ok">selected</Badge>}</span> },
                { header: 'MAE', align: 'right', cell: (m) => (m.failed ? 'failed' : formatNumber(m.mae)) },
                { header: 'RMSE', align: 'right', cell: (m) => (m.failed ? '—' : formatNumber(m.rmse)) },
                { header: 'WAPE', align: 'right', cell: (m) => formatPercent(m.wape) },
                { header: 'Bias', align: 'right', cell: (m) => (m.failed ? '—' : formatNumber(m.bias)) },
                { header: 'vs same-weekday-last-week', align: 'right', cell: (m) => (m.skillVsSeasonalNaive === null ? '—' : `${(m.skillVsSeasonalNaive * 100).toFixed(0)}% lower error`) },
              ]}
            />
            <p className="mt-2 text-xs text-muted">
              {data.backtest.folds} rolling backtests of {data.backtest.horizonDays} days, {data.backtest.strideDays} days apart. MAE and RMSE are in the units of the measure;
              WAPE is MAE ÷ actual total. Bias above 0 means the model over-forecasts. Data used: {data.dataQuality.days} days
              ({data.dataQuality.firstDate} to {data.dataQuality.lastDate}), {data.dataQuality.missingDays} filled as zero.
            </p>
          </Card>

          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
            {data.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

function ForecastProblem({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  // The service answers 422 when there is nothing honest to forecast; that is guidance, not a failure.
  if (error.status === 422) {
    return <EmptyState title={error.title}>{error.message}</EmptyState>;
  }
  return <ErrorState error={error} onRetry={onRetry} />;
}
