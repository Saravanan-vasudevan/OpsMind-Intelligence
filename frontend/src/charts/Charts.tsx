import { useState, type ReactNode } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { DowntimeReasonRow, PlantComparisonRow, TrendPoint } from '../api/types';
import { formatDate, formatMinutes, formatNumber, formatPercent } from '../lib/format';
import { Button, DataTable, EmptyState } from '../components/ui';

// Checked with the dataviz palette validator (light mode): CVD and normal-vision separation pass.
export const SERIES_A = '#1d6fa5';
export const SERIES_B = '#c2641c';
const AXIS = '#5b6675';
const GRID = '#e4e8ed';

/** Every chart can be switched to an equivalent table, so values are readable without colour or hover. */
function ChartFrame({ label, chart, table }: { label: string; chart: ReactNode; table: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Button variant="ghost" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? 'Show chart' : 'Show as table'}
        </Button>
      </div>
      {showTable ? table : <div role="img" aria-label={label} className="h-64">{chart}</div>}
    </div>
  );
}

export function TrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <EmptyState title="No production in this period">Try a wider date range or add production records.</EmptyState>;
  return (
    <ChartFrame
      label="Units produced against target over time"
      chart={
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={(d: string) => formatDate(d).slice(0, 6)} stroke={AXIS} fontSize={12} minTickGap={24} />
            <YAxis stroke={AXIS} fontSize={12} width={56} tickFormatter={(v: number) => formatNumber(v)} />
            <Tooltip labelFormatter={(d) => formatDate(String(d))} formatter={(v) => formatNumber(Number(v))} />
            <Legend />
            <Line name="Units produced" dataKey="units" stroke={SERIES_A} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line name="Target units" dataKey="targetUnits" stroke={SERIES_B} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      }
      table={
        <DataTable
          caption="Units produced and target by period"
          rows={data}
          rowKey={(r) => r.date}
          columns={[
            { header: 'Period starting', cell: (r) => formatDate(r.date) },
            { header: 'Units', align: 'right', cell: (r) => formatNumber(r.units) },
            { header: 'Target', align: 'right', cell: (r) => formatNumber(r.targetUnits) },
            { header: 'Defect rate', align: 'right', cell: (r) => formatPercent(r.defectRate) },
          ]}
        />
      }
    />
  );
}

export function DowntimePareto({ data }: { data: DowntimeReasonRow[] }) {
  if (data.length === 0) return <EmptyState title="No downtime recorded in this period" />;
  const rows = data.slice(0, 10);
  return (
    <ChartFrame
      label="Downtime minutes by reason code"
      chart={
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" stroke={AXIS} fontSize={12} tickFormatter={(v: number) => formatNumber(v)} />
            <YAxis type="category" dataKey="reasonCode" stroke={AXIS} fontSize={12} width={110} />
            <Tooltip formatter={(v) => formatMinutes(Number(v))} />
            <Bar dataKey="minutes" name="Downtime" fill={SERIES_B} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      }
      table={
        <DataTable
          caption="Downtime by reason code"
          rows={data}
          rowKey={(r) => `${r.reasonCode}-${r.category}`}
          columns={[
            { header: 'Reason', cell: (r) => r.reasonCode },
            { header: 'Category', cell: (r) => r.category },
            { header: 'Events', align: 'right', cell: (r) => formatNumber(r.events) },
            { header: 'Duration', align: 'right', cell: (r) => formatMinutes(r.minutes) },
          ]}
        />
      }
    />
  );
}

export function PlantComparison({ data }: { data: PlantComparisonRow[] }) {
  if (data.length === 0) return <EmptyState title="No plants have data in this period" />;
  return (
    <DataTable
      caption="Plant comparison"
      rows={data}
      rowKey={(r) => r.plantId}
      columns={[
        { header: 'Plant', cell: (r) => r.plantName },
        { header: 'Units', align: 'right', cell: (r) => formatNumber(r.units) },
        { header: 'Target attainment', align: 'right', cell: (r) => formatPercent(r.targetAttainment) },
        { header: 'Utilisation', align: 'right', cell: (r) => formatPercent(r.utilisation) },
        { header: 'Availability', align: 'right', cell: (r) => formatPercent(r.availability) },
        { header: 'Unplanned downtime', align: 'right', cell: (r) => formatMinutes(r.unplannedDowntimeMinutes) },
        { header: 'Defect rate', align: 'right', cell: (r) => formatPercent(r.defectRate) },
      ]}
    />
  );
}
