import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForecastPage } from './ForecastPage';
import { toForecastSeries } from '../charts/IntelligenceCharts';
import type { Forecast } from '../api/types';

const forecast: Forecast = {
  metric: 'units', scope: { plantId: null, plantName: null, equipmentId: null, assetCode: null }, horizonDays: 14,
  selectedModel: 'holt_winters', selectedModelDescription: 'Damped trend with weekly seasonality.', intervalLevel: 0.8,
  history: [{ date: '2026-03-01', value: 100 }, { date: '2026-03-02', value: 110 }],
  forecast: [{ date: '2026-03-03', point: 105, lower: 90, upper: 120 }, { date: '2026-03-04', point: 107, lower: 92, upper: 123 }],
  backtest: {
    folds: 3, horizonDays: 14, strideDays: 7,
    models: [
      { name: 'seasonal_naive', description: 'Same weekday last week.', selected: false, failed: false, mae: 12.5, rmse: 15, wape: 0.08, bias: 1, skillVsSeasonalNaive: null },
      { name: 'holt_winters', description: 'Damped trend.', selected: true, failed: false, mae: 10, rmse: 13, wape: 0.064, bias: -0.5, skillVsSeasonalNaive: 0.2 },
    ],
  },
  dataQuality: { firstDate: '2026-01-01', lastDate: '2026-03-02', days: 61, missingDays: 0, droppedToday: false, requiredDays: 56 },
  notes: ['Interval is indicative.'],
};

function stub(handler: (url: string) => Response) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    if (url.startsWith('/api/plants')) return Response.json([{ id: 'p1', name: 'North Plant' }]);
    if (url.startsWith('/api/equipment')) return Response.json({ items: [{ id: 'e1', assetCode: 'N1-M01' }], page: 1, pageSize: 200, totalCount: 1 });
    return handler(url);
  }));
  return urls;
}
const renderPage = () => render(<MemoryRouter><ForecastPage /></MemoryRouter>);
afterEach(() => vi.unstubAllGlobals());

describe('ForecastPage', () => {
  it('shows the chosen model, the backtest scores and the caveats exactly as returned', async () => {
    stub(() => Response.json(forecast));
    renderPage();
    const table = await screen.findByRole('table', { name: 'Backtest results by model' }, { timeout: 3000 });
    const selectedRow = within(table).getByText('holt winters').closest('tr')!;
    expect(within(selectedRow).getByText('selected')).toBeInTheDocument();
    expect(within(selectedRow).getByText('20% lower error')).toBeInTheDocument();
    expect(screen.getByText('Interval is indicative.')).toBeInTheDocument();
  });

  it('asks again with the new options when the horizon or measure changes', async () => {
    const urls = stub(() => Response.json(forecast));
    renderPage();
    await screen.findByRole('table', { name: 'Backtest results by model' });
    await userEvent.selectOptions(screen.getByLabelText('Days ahead'), '28');
    await userEvent.selectOptions(screen.getByLabelText('Measure'), 'unplanned_downtime_minutes');
    await screen.findByRole('table', { name: 'Backtest results by model' });
    expect(urls.some((u) => u.includes('/api/intelligence/forecast') && u.includes('horizon=28') && u.includes('metric=unplanned_downtime_minutes'))).toBe(true);
  });

  it('explains insufficient history instead of showing an error or a made-up forecast', async () => {
    stub(() => Response.json({ title: 'Not enough history', detail: 'Need at least 56 days; found 12.', code: 'insufficient_history' }, { status: 422 }));
    renderPage();
    expect(await screen.findByText('Not enough history')).toBeInTheDocument();
    expect(screen.getByText('Need at least 56 days; found 12.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a retryable error for service failures', async () => {
    stub(() => Response.json({ title: 'Intelligence service unavailable', detail: 'The analysis service is not reachable right now.' }, { status: 503 }));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('not reachable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('offers the forecast as a table', async () => {
    stub(() => Response.json(forecast));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Show as table' }));
    const table = await screen.findByRole('table', { name: 'Forecast values with interval' });
    expect(within(table).getByText('120')).toBeInTheDocument();
  });
});

describe('toForecastSeries', () => {
  it('starts the forecast line at the last actual value and keeps interval bands only on forecast days', () => {
    const rows = toForecastSeries(forecast);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toMatchObject({ date: '2026-03-02', actual: 110, point: 110 });
    expect(rows[1].band).toBeUndefined();
    expect(rows[2]).toMatchObject({ date: '2026-03-03', point: 105, band: [90, 120] });
    expect(rows[2].actual).toBeUndefined();
  });
});
