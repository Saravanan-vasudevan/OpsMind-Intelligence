import { useState } from 'react';
import { plants as plantsApi, reliability as reliabilityApi } from '../api/endpoints';
import type { Filters, ReliabilityRow } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { daysAgo, formatMinutes, formatNumber, formatPercent, toIsoDate } from '../lib/format';
import { Card, DataTable, EmptyState, ErrorState, LoadingBlock, PageHeader } from '../components/ui';
import { FilterBar } from '../components/FilterBar';
import { ReliabilityPareto } from '../charts/IntelligenceCharts';

export function ReliabilityPage() {
  const [filters, setFilters] = useState<Filters>(() => ({ from: daysAgo(29), to: toIsoDate(new Date()) }));
  const plantList = useAsync(() => plantsApi.list(), []);
  const rows = useAsync((s) => reliabilityApi.list(filters, s), [JSON.stringify(filters)]);

  return (
    <>
      <PageHeader
        title="Reliability"
        description="Failures, mean time between failures (MTBF), mean time to repair (MTTR) and availability for each machine, calculated in the database from your production and downtime records."
      />
      <FilterBar filters={filters} plants={plantList.data ?? []} onChange={setFilters} />
      {rows.error ? <ErrorState error={rows.error} onRetry={rows.reload} /> : rows.loading && !rows.data ? <LoadingBlock label="Loading reliability" /> : null}
      {rows.data && rows.data.length === 0 && (
        <EmptyState title="No machine activity in this period">Import or enter production and downtime records, or widen the date range.</EmptyState>
      )}
      {rows.data && rows.data.length > 0 && (
        <>
          <Card title="Unplanned downtime by machine">
            <ReliabilityPareto rows={rows.data} />
          </Card>
          <div className="mt-5">
            <DataTable<ReliabilityRow>
              caption="Equipment reliability"
              rows={rows.data}
              rowKey={(r) => r.equipmentId}
              columns={[
                { header: 'Plant', cell: (r) => r.plantName },
                { header: 'Machine', cell: (r) => <span title={r.equipmentName}>{r.assetCode}</span> },
                { header: 'Failures', align: 'right', cell: (r) => formatNumber(r.failures) },
                { header: 'Unplanned', align: 'right', cell: (r) => formatMinutes(r.unplannedMinutes) },
                { header: 'MTBF', align: 'right', cell: (r) => formatMinutes(r.mtbfMinutes) },
                { header: 'MTTR', align: 'right', cell: (r) => formatMinutes(r.mttrMinutes) },
                { header: 'Availability', align: 'right', cell: (r) => formatPercent(r.availability) },
                { header: 'Rank in plant', align: 'right', cell: (r) => formatNumber(r.downtimeRankInPlant) },
                { header: 'Share of plant', align: 'right', cell: (r) => (r.pctOfPlantUnplanned === null ? '—' : `${r.pctOfPlantUnplanned.toFixed(1)}%`) },
                { header: 'Cumulative', align: 'right', cell: (r) => (r.cumulativePctOfPlant === null ? '—' : `${r.cumulativePctOfPlant.toFixed(1)}%`) },
              ]}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            MTBF = run minutes ÷ unplanned failures; it shows — for a machine with no failure in the period, because dividing by zero is not a time.
            MTTR = unplanned downtime ÷ failures. Rank, share and cumulative share are window functions per plant.
          </p>
        </>
      )}
    </>
  );
}
