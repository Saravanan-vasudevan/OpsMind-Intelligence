import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportsPage } from './ImportsPage';

let admin = true;
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ isAdmin: admin }) }));

const batch = {
  id: 'b1', kind: 'production', fileName: 'march.csv', sourceFormat: 'csv', conflictPolicy: 'skip', strict: false, status: 'Completed',
  totalRows: 100, insertedRows: 97, updatedRows: 0, skippedRows: 0, rejectedRows: 3, errorsTruncated: false, message: 'Loaded 97 of 100 rows.',
  uploadedBy: 'Alice Admin', startedAt: '2026-03-02T09:00:00Z', completedAt: '2026-03-02T09:00:02Z',
};
const result = {
  batchId: 'b2', kind: 'production', fileName: 'new.csv', status: 'Completed', totalRows: 10, insertedRows: 8, updatedRows: 0, skippedRows: 0,
  rejectedRows: 2, errorsTruncated: false, message: 'Loaded 8 of 10 rows. 2 rows were rejected.', alreadyImported: false, warnings: [],
  errorsPreview: [{ rowNumber: 4, column: 'units_produced', code: 'negative', message: 'units_produced cannot be negative.', rawValue: '-5' }],
};

function stub(upload: () => Response = () => Response.json(result)) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = url.split('?')[0];
    if (path === '/api/imports' && init?.method === 'POST') return upload();
    if (path === '/api/imports') return Response.json({ items: [batch], page: 1, pageSize: 10, totalCount: 1 });
    if (path === '/api/imports/b1/errors') return Response.json({ items: result.errorsPreview, page: 1, pageSize: 50, totalCount: 1 });
    return new Response('{}', { status: 404 });
  }));
  return calls;
}

const renderPage = () => render(<MemoryRouter><ImportsPage /></MemoryRouter>);
afterEach(() => { vi.unstubAllGlobals(); admin = true; });

describe('ImportsPage', () => {
  it('lists the import history with counts and who uploaded', async () => {
    stub();
    renderPage();
    const table = await screen.findByRole('table', { name: 'Import history' });
    expect(within(table).getByText('march.csv')).toBeInTheDocument();
    expect(within(table).getByText('97')).toBeInTheDocument();
    expect(within(table).getByText('Alice Admin')).toBeInTheDocument();
  });

  it('uploads the chosen file as multipart form data and shows what was loaded and what was rejected', async () => {
    const calls = stub();
    renderPage();
    const file = new File(['plant_code\nNORTH\n'], 'new.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText(/File \(\.csv or \.xlsx/), file);
    await userEvent.click(screen.getByRole('button', { name: 'Upload and check' }));

    const panel = await screen.findByTestId('import-result');
    expect(panel).toHaveTextContent('Loaded 8 of 10 rows');
    expect(within(panel).getByText('units_produced cannot be negative.')).toBeInTheDocument();
    expect(within(panel).getByText('-5')).toBeInTheDocument();

    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(post.init!.body).toBeInstanceOf(FormData);
    const form = post.init!.body as FormData;
    expect(form.get('kind')).toBe('production');
    expect(form.get('conflictPolicy')).toBe('skip');
    expect((form.get('file') as File).name).toBe('new.csv');
    // The browser must choose the multipart boundary itself.
    expect((post.init!.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((post.init!.headers as Record<string, string>)['X-Requested-With']).toBe('OpsMind');
  });

  it('keeps the upload button disabled until a file is chosen', async () => {
    stub();
    renderPage();
    expect(screen.getByRole('button', { name: 'Upload and check' })).toBeDisabled();
  });

  it('says so when the same file was already imported', async () => {
    stub(() => Response.json({ ...result, alreadyImported: true, rejectedRows: 0, errorsPreview: [] }));
    renderPage();
    await userEvent.upload(screen.getByLabelText(/File \(\.csv or \.xlsx/), new File(['x'], 'again.csv'));
    await userEvent.click(screen.getByRole('button', { name: 'Upload and check' }));
    expect(await screen.findByText(/already imported/i)).toBeInTheDocument();
  });

  it('shows the server problem when the upload is not accepted', async () => {
    stub(() => Response.json({ title: 'Upload not accepted', detail: 'Only .csv and .xlsx files are supported.' }, { status: 415 }));
    renderPage();
    await userEvent.upload(screen.getByLabelText(/File \(\.csv or \.xlsx/), new File(['x'], 'a.csv'));
    await userEvent.click(screen.getByRole('button', { name: 'Upload and check' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only .csv and .xlsx files are supported.');
  });

  it('opens the stored row problems for a batch', async () => {
    stub();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'View problems for march.csv' }));
    expect(await screen.findByRole('table', { name: 'Problems found in this file' })).toBeInTheDocument();
    expect(screen.getByText('units_produced cannot be negative.')).toBeInTheDocument();
  });

  it('hides the upload form from non-administrators', async () => {
    admin = false;
    stub();
    renderPage();
    expect(await screen.findByText(/Only administrators can upload/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload and check' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('table', { name: 'Import history' })).toBeInTheDocument());
  });

  it('points the template link at the header-only file for the chosen type', async () => {
    stub();
    renderPage();
    expect(screen.getByRole('link', { name: /production template/ })).toHaveAttribute('href', '/templates/production_template.csv');
    await userEvent.selectOptions(screen.getByLabelText('What is in the file?'), 'downtime');
    expect(screen.getByRole('link', { name: /downtime template/ })).toHaveAttribute('href', '/templates/downtime_template.csv');
  });
});
