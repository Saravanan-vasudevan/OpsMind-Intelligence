import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AdminRoute, ProtectedRoute } from './ProtectedRoute';
import * as AuthModule from './AuthContext';
import type { User } from '../api/types';

const user = (role: 'Admin' | 'User'): User => ({
  id: '1', email: 'a@b.c', fullName: 'A', role, isActive: true, organisationId: 'o', organisationName: 'Org', createdAt: '2026-01-01T00:00:00Z',
});

function mockAuth(partial: Partial<ReturnType<typeof AuthModule.useAuth>>) {
  vi.spyOn(AuthModule, 'useAuth').mockReturnValue({
    user: null, loading: false, isAdmin: false, login: vi.fn(), register: vi.fn(), logout: vi.fn(), setUser: vi.fn(), ...partial,
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>Login page</p>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<p>Home</p>} />
          <Route element={<AdminRoute />}><Route path="/users" element={<p>Users page</p>} /></Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('route guards', () => {
  it('redirects signed-out visitors to login', () => {
    mockAuth({ user: null });
    renderAt('/');
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });
  it('shows a loading state while the session is checked', () => {
    mockAuth({ loading: true });
    renderAt('/');
    expect(screen.getByRole('status')).toHaveTextContent(/checking your session/i);
  });
  it('lets a signed-in user through', () => {
    mockAuth({ user: user('User') });
    renderAt('/');
    expect(screen.getByText('Home')).toBeInTheDocument();
  });
  it('blocks standard users from admin pages', () => {
    mockAuth({ user: user('User'), isAdmin: false });
    renderAt('/users');
    expect(screen.getByRole('alert')).toHaveTextContent(/admin access required/i);
  });
  it('allows admins into admin pages', () => {
    mockAuth({ user: user('Admin'), isAdmin: true });
    renderAt('/users');
    expect(screen.getByText('Users page')).toBeInTheDocument();
  });
});
