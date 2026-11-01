import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnomaliesPage } from './AnomaliesPage';

const response = {
  method: 'robust_z', from: '2026-03-01', to: '2026-03-30', parameters: { threshold: 3.5 }, machineDaysEvaluated: 700, totalFlags: 3, returned: 1,
  anomalies: [{
    equipmentId: 'e1', assetCode: 'N1-M01', date: '2026-03-12', metric: 'defect_rate', value: 0.09, baseline: 0.02, score: 6.4, method: 'robust_z',
    explanation: 'Defect rate was 9.0% against a usual 2.0% for this machine on a Thursday.',
  }],
  notes: ['Flags are prompts to look, not diagnoses.'],
};
const evaluation = {
  dataset: { kind: 'synthetic, anomalies injected', seed: 2024, days: 180, machines: 24, evaluatedMachineDays: 2640, injectedAnomalies: 38 },
  detectors: {
    robust_z: { injectedFound: 27, injectedMissed: 11, precision: 0.314, recall: 0.711, falseAlarmsPer1000MachineDays: 26.5, flagsOnCleanData: 76 },
  },
  limitations: ['Synthetic data with independent noise.'],
};

function stub(anomalies: () => Response = () => Response.json(response)) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    if (url.startsWith('/api/plants')) return Response.json([]);
    if (url.startsWith('/api/intelligence/anomalies/evaluation')) return Response.json(evaluation);
    if (url.startsWith('/api/intelligence/anomalies')) return anomalies();
    return new Response('{}', { status: 404 });
  }));
  return urls;
}
const renderPage = () => render(<MemoryRouter><AnomaliesPage /></MemoryRouter>);
afterEach(() => vi.unstubAllGlobals());

describe('AnomaliesPage', () => {
  it('lists flags with the plain-language explanation and how many were checked', async () => {
    stub();
    renderPage();
    const table = await screen.findByRole('table', { name: 'Flagged machine-days' });
    expect(within(table).getByText('N1-M01')).toBeInTheDocument();
    expect(within(table).getByText(/9\.0% against a usual 2\.0%/)).toBeInTheDocument();
    expect(screen.getByTestId('anomaly-summary')).toHaveTextContent('3 flags across 700 machine-days checked (showing the 1 strongest)');
  });

  it('says nothing was flagged without claiming that nothing is wrong', async () => {
    stub(() => Response.json({ ...response, totalFlags: 0, returned: 0, anomalies: [] }));
    renderPage();
    expect(await screen.findByText('Nothing unusual in this period')).toBeInTheDocument();
    expect(screen.getByText(/not proof that nothing went wrong/)).toBeInTheDocument();
  });

  it('requests the selected method', async () => {
    const urls = stub();
    renderPage();
    await screen.findByRole('table', { name: 'Flagged machine-days' });
    await userEvent.selectOptions(screen.getByLabelText('Method'), 'isolation_forest');
    await screen.findByRole('table', { name: 'Flagged machine-days' });
    expect(urls.some((u) => u.includes('method=isolation_forest'))).toBe(true);
  });

  it('shows the benchmark only on request and labels it as synthetic with its limitations', async () => {
    const urls = stub();
    renderPage();
    await screen.findByRole('table', { name: 'Flagged machine-days' });
    expect(urls.some((u) => u.includes('/evaluation'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Show evaluation' }));
    expect(await screen.findByText('Synthetic benchmark.')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Detector performance on the synthetic benchmark' });
    expect(within(table).getByText('27 of 38 (71%)')).toBeInTheDocument();
    expect(within(table).getByText('31%')).toBeInTheDocument();
    expect(screen.getByText('Synthetic data with independent noise.')).toBeInTheDocument();
  });

  it('shows a retryable error when the service fails', async () => {
    stub(() => Response.json({ title: 'Intelligence service unavailable', detail: 'Try again shortly.' }, { status: 503 }));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again shortly.');
  });
});
