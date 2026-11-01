import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReliabilityPage } from './ReliabilityPage';

const row = (over: Record<string, unknown>) => ({
  equipmentId: 'e1', assetCode: 'N1-M01', equipmentName: 'Press 1', plantId: 'p1', plantName: 'North Plant', lineName: 'L1', failures: 2,
  unplannedMinutes: 120, plannedMinutes: 30, runMinutes: 4000, scheduledMinutes: 4800, mtbfMinutes: 2000, mttrMinutes: 60, availability: 0.9667,
  downtimeRankInPlant: 1, pctOfPlantUnplanned: 70.5, cumulativePctOfPlant: 70.5, ...over,
});

function stub(rows: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/plants')) return Response.json([]);
    if (url.startsWith('/api/analytics/reliability')) return Response.json(rows);
    return new Response('{}', { status: 404 });
  }));
}
const renderPage = () => render(<MemoryRouter><ReliabilityPage /></MemoryRouter>);
afterEach(() => vi.unstubAllGlobals());

describe('ReliabilityPage', () => {
  it('shows MTBF, MTTR and availability from the API', async () => {
    stub([row({})]);
    renderPage();
    const table = await screen.findByRole('table', { name: 'Equipment reliability' });
    const r = within(table).getByText('N1-M01').closest('tr')!;
    expect(within(r).getByText('33 h 20 min')).toBeInTheDocument();   // MTBF 2000 minutes
    expect(within(r).getByText('1 h 00 min')).toBeInTheDocument();    // MTTR 60 minutes
    expect(within(r).getByText('96.7%')).toBeInTheDocument();
    expect(within(r).getAllByText('70.5%')).toHaveLength(2);   // share and cumulative share
  });

  it('shows — for MTBF and MTTR of a machine with no failures, never 0', async () => {
    stub([row({ assetCode: 'N1-M02', failures: 0, unplannedMinutes: 0, mtbfMinutes: null, mttrMinutes: null, pctOfPlantUnplanned: null, cumulativePctOfPlant: null, downtimeRankInPlant: 2 })]);
    renderPage();
    const table = await screen.findByRole('table', { name: 'Equipment reliability' });
    const r = within(table).getByText('N1-M02').closest('tr')!;
    const cells = within(r).getAllByRole('cell').map((c) => c.textContent);
    expect(cells[4]).toBe('—');
    expect(cells[5]).toBe('—');
    expect(cells[8]).toBe('—');
  });

  it('shows an empty state for a period without activity', async () => {
    stub([]);
    renderPage();
    expect(await screen.findByText('No machine activity in this period')).toBeInTheDocument();
  });
});
