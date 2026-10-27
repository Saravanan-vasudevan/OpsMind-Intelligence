import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { LoginPage } from './AuthPages';

const demoUser = { id: '1', email: 'demo@x.y', fullName: 'Demo', role: 'Admin', isActive: true, organisationId: 'o', organisationName: 'Org', createdAt: '2026-01-01T00:00:00Z' };

function json(status: number, body: unknown) { return new Response(JSON.stringify(body), { status }); }

function setup(fetchImpl: (url: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => fetchImpl(url)));
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>Dashboard</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('signs in and navigates to the app', async () => {
    setup((url) => (url === '/api/auth/me' ? json(401, { title: 'Unauthorized' }) : json(200, demoUser)));
    await userEvent.type(await screen.findByLabelText('Email'), 'demo@x.y');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pass-1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it('shows the server message when credentials are wrong and stays on the page', async () => {
    setup((url) => (url === '/api/auth/me' ? json(401, {}) : json(401, { title: 'Unauthorized', detail: 'Invalid email or password.' })));
    await userEvent.type(await screen.findByLabelText('Email'), 'demo@x.y');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.'));
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('redirects away from login if a session already exists', async () => {
    setup(() => json(200, demoUser));
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });
});
