import { useState } from 'react';
import { analytics, exportsApi, intelligence, plants as plantsApi } from '../api/endpoints';
import type { Filters, Granularity } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { daysAgo, formatMinutes, formatNumber, formatPercent, toIsoDate } from '../lib/format';
import { Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Select } from '../components/ui';
import { KpiCard } from '../components/KpiCard';
import { FilterBar } from '../components/FilterBar';
import { DowntimePareto, PlantComparison, TrendChart } from '../charts/Charts';

export function OverviewPage() {
  const [filters, setFilters] = useState<Filters>(() => ({ from: daysAgo(29), to: toIsoDate(new Date()) }));
  const [granularity, setGranularity] = useState<Granularity>('day');

  const plantList = useAsync(() => plantsApi.list(), []);
  const key = JSON.stringify(filters);
  const summary = useAsync((s) => analytics.summary(filters, s), [key]);
  const trend = useAsync((s) => analytics.trend(filters, granularity, s), [key, granularity]);
  const comparison = useAsync((s) => analytics.plantComparison(filters, s), [key]);
  const reasons = useAsync((s) => analytics.downtimeReasons(filters, s), [key]);

  const noData = summary.data?.recordCount === 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Production, availability and quality for the selected period. Figures are calculated by the API from the records you have entered."
        actions={
          <>
            <a className="rounded border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-paper" href={exportsApi.productionCsvUrl(filters)}>Export CSV</a>
            <a className="rounded border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-paper" href={intelligence.reportUrl(filters)}>Excel report</a>
          </>
        }
      />
      <FilterBar filters={filters} plants={plantList.data ?? []} onChange={setFilters} />

      {summary.error ? <ErrorState error={summary.error} onRetry={summary.reload} /> : summary.loading && !summary.data ? <LoadingBlock label="Loading KPIs" /> : null}

      {summary.data && noData && (
        <EmptyState title="No production records in this period">
          Enter records under Production &amp; downtime, or widen the date range.
        </EmptyState>
      )}

      {summary.data && !noData && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Units produced" value={formatNumber(summary.data.totalUnits)} detail={`Target ${formatNumber(summary.data.totalTargetUnits)}`} />
            <KpiCard label="Target attainment" value={formatPercent(summary.data.targetAttainment)} detail="Units ÷ target units" />
            <KpiCard label="Availability" value={formatPercent(summary.data.availability)} detail={`Unplanned downtime ${formatMinutes(summary.data.unplannedDowntimeMinutes)}`} />
            <KpiCard label="Defect rate" value={formatPercent(summary.data.defectRate)} detail={`${formatNumber(summary.data.rejectedUnits)} of ${formatNumber(summary.data.inspectedUnits)} inspected`} />
          </div>
          <p className="mt-2 text-xs text-muted">
            Utilisation {formatPercent(summary.data.utilisation)} · Scheduled time is taken from the shifts of recorded production, so a shift with no record is not counted.
          </p>
        </>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card
          title="Units against target"
          actions={
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted">Group by</span>
              <Select value={granularity} onChange={(e) => setGranularity(e.target.value as Granularity)} className="!w-auto">
                <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
              </Select>
            </label>
          }
        >
          {trend.error ? <ErrorState error={trend.error} onRetry={trend.reload} /> : trend.loading && !trend.data ? <LoadingBlock /> : <TrendChart data={trend.data ?? []} />}
        </Card>
        <Card title="Downtime by reason">
          {reasons.error ? <ErrorState error={reasons.error} onRetry={reasons.reload} /> : reasons.loading && !reasons.data ? <LoadingBlock /> : <DowntimePareto data={reasons.data ?? []} />}
        </Card>
      </div>

      <Card title="Plant comparison" className="mt-5">
        {comparison.error ? <ErrorState error={comparison.error} onRetry={comparison.reload} /> : comparison.loading && !comparison.data ? <LoadingBlock /> : <PlantComparison data={comparison.data ?? []} />}
      </Card>
    </>
  );
}
