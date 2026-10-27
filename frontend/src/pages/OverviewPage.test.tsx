import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverviewPage } from './OverviewPage';

const summary = {
  recordCount: 10, totalUnits: 12000, totalTargetUnits: 15000, targetAttainment: 0.8, scheduledMinutes: 4800, runMinutes: 4000,
  utilisation: 0.8333, plannedDowntimeMinutes: 60, unplannedDowntimeMinutes: 300, availability: 0.9367, inspectedUnits: 1000, rejectedUnits: 25, defectRate: 0.025,
};
const trend = [{ date: '2026-03-01', units: 1000, targetUnits: 1200, inspectedUnits: 100, rejectedUnits: 2, defectRate: 0.02 }];
const reasons = [{ reasonCode: 'JAM', category: 'Unplanned', minutes: 200, events: 4 }];
const comparison = [{ plantId: 'p', plantName: 'North', units: 12000, targetUnits: 15000, targetAttainment: 0.8, utilisation: 0.83, availability: 0.94, unplannedDowntimeMinutes: 300, defectRate: 0.025 }];

function stub(overrides: Record<string, () => Response> = {}) {
  const routes: Record<string, () => Response> = {
    '/api/plants': () => Response.json([]),
    '/api/analytics/summary': () => Response.json(summary),
    '/api/analytics/trend': () => Response.json(trend),
    '/api/analytics/downtime-reasons': () => Response.json(reasons),
    '/api/analytics/plant-comparison': () => Response.json(comparison),
    ...overrides,
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.split('?')[0];
    const handler = routes[path];
    return handler ? handler() : new Response('{}', { status: 404 });
  }));
}

const renderPage = () => render(<MemoryRouter><OverviewPage /></MemoryRouter>);
afterEach(() => vi.unstubAllGlobals());

describe('OverviewPage', () => {
  it('shows KPI values exactly as returned by the API', async () => {
    stub();
    renderPage();
    expect(await screen.findByTestId('kpi-Units produced')).toHaveTextContent('12,000');
    expect(screen.getByTestId('kpi-Target attainment')).toHaveTextContent('80.0%');
    expect(screen.getByTestId('kpi-Availability')).toHaveTextContent('93.7%');
    expect(screen.getByTestId('kpi-Defect rate')).toHaveTextContent('2.5%');
  });

  it('shows an empty state instead of zero KPIs when there are no records', async () => {
    stub({ '/api/analytics/summary': () => Response.json({ ...summary, recordCount: 0, targetAttainment: null }) });
    renderPage();
    expect(await screen.findByText('No production records in this period')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-Units produced')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the API fails', async () => {
    stub({ '/api/analytics/summary': () => Response.json({ title: 'Server error', detail: 'Database is down.' }, { status: 500 }) });
    renderPage();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts[0]).toHaveTextContent('Database is down.');
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0);
  });

  it('offers a table view of the trend chart', async () => {
    stub();
    renderPage();
    const toggles = await screen.findAllByRole('button', { name: 'Show as table' });
    await userEvent.click(toggles[0]);
    expect(await screen.findByRole('table', { name: /units produced and target/i })).toBeInTheDocument();
  });

  it('links the CSV export to the current filters', async () => {
    stub();
    renderPage();
    const link = await screen.findByRole('link', { name: 'Export CSV' });
    expect(link.getAttribute('href')).toMatch(/^\/api\/exports\/production-records\.csv\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
  });
});
