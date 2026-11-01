import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Forecast, ReliabilityRow } from '../api/types';
import { formatDate, formatMinutes, formatNumber } from '../lib/format';
import { DataTable, EmptyState } from '../components/ui';
import { SERIES_A, SERIES_B } from './Charts';

const AXIS = '#5b6675';
const GRID = '#e4e8ed';

interface ForecastPoint {
  date: string;
  actual?: number;
  point?: number;
  band?: [number, number];
}

/** History and forecast share one date axis; the forecast starts on the day after the last actual value. */
export function toForecastSeries(f: Forecast): ForecastPoint[] {
  const rows: ForecastPoint[] = f.history.map((h) => ({ date: h.date, actual: h.value }));
  // Join the lines visually: the last actual value is also the first point of the forecast line.
  const last = rows[rows.length - 1];
  if (last) last.point = last.actual;
  for (const p of f.forecast) rows.push({ date: p.date, point: p.point, band: [p.lower, p.upper] });
  return rows;
}

export function ForecastChart({ forecast, valueLabel }: { forecast: Forecast; valueLabel: string }) {
  const data = toForecastSeries(forecast);
  const percent = Math.round(forecast.intervalLevel * 100);
  return (
    <div role="img" aria-label={`${valueLabel}: recent actual values and a ${forecast.horizonDays}-day forecast with a ${percent}% interval`} className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d: string) => formatDate(d).slice(0, 6)} stroke={AXIS} fontSize={12} minTickGap={28} />
          <YAxis stroke={AXIS} fontSize={12} width={56} tickFormatter={(v: number) => formatNumber(v)} />
          <Tooltip
            labelFormatter={(d) => formatDate(String(d))}
            formatter={(v, name) => [Array.isArray(v) ? `${formatNumber(Number(v[0]))} to ${formatNumber(Number(v[1]))}` : formatNumber(Number(v)), name]}
          />
          <Legend />
          <Area name={`${percent}% interval`} dataKey="band" stroke="none" fill={SERIES_A} fillOpacity={0.16} isAnimationActive={false} />
          <Line name="Actual" dataKey="actual" stroke={SERIES_A} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line name="Forecast" dataKey="point" stroke={SERIES_B} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ForecastTable({ forecast }: { forecast: Forecast }) {
  return (
    <DataTable
      caption="Forecast values with interval"
      rows={forecast.forecast}
      rowKey={(r) => r.date}
      columns={[
        { header: 'Date', cell: (r) => formatDate(r.date) },
        { header: 'Forecast', align: 'right', cell: (r) => formatNumber(r.point) },
        { header: 'Lower', align: 'right', cell: (r) => formatNumber(r.lower) },
        { header: 'Upper', align: 'right', cell: (r) => formatNumber(r.upper) },
      ]}
    />
  );
}

/** Unplanned downtime per machine, largest first (a Pareto by machine). */
export function ReliabilityPareto({ rows }: { rows: ReliabilityRow[] }) {
  const top = [...rows].sort((a, b) => b.unplannedMinutes - a.unplannedMinutes).slice(0, 10);
  if (top.length === 0 || top.every((r) => r.unplannedMinutes === 0)) return <EmptyState title="No unplanned downtime in this period" />;
  return (
    <div role="img" aria-label="Unplanned downtime minutes by machine, largest first" className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={top} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" stroke={AXIS} fontSize={12} tickFormatter={(v: number) => formatNumber(v)} />
          <YAxis type="category" dataKey="assetCode" stroke={AXIS} fontSize={12} width={72} />
          <Tooltip formatter={(v) => formatMinutes(Number(v))} />
          <Bar dataKey="unplannedMinutes" name="Unplanned downtime" fill={SERIES_B} radius={[0, 3, 3, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
