import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button, cx } from './ui';

const mainLinks = [
  { to: '/', label: 'Overview', end: true },
  { to: '/records', label: 'Production & downtime' },
  { to: '/plants', label: 'Plants' },
  { to: '/equipment', label: 'Equipment' },
];
const adminLinks = [
  { to: '/users', label: 'Users' },
  { to: '/audit', label: 'Audit log' },
];

function NavItem({ to, label, end, onClick }: { to: string; label: string; end?: boolean; onClick: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cx('block rounded px-3 py-2 text-sm', isActive ? 'bg-white/15 font-medium text-white' : 'text-white/75 hover:bg-white/10 hover:text-white')
      }
    >
      {label}
    </NavLink>
  );
}

export function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2">Skip to content</a>
      <header className="flex items-center justify-between bg-ink px-4 py-3 text-white md:hidden">
        <span className="font-semibold">OpsMind</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-white/30 px-2 py-1 text-sm"
        >
          Menu
        </button>
      </header>

      <aside
        id="sidebar"
        className={cx('flex-col bg-ink p-3 text-white md:sticky md:top-0 md:flex md:h-screen md:w-56 md:shrink-0', open ? 'flex' : 'hidden')}
      >
        <div className="mb-4 hidden px-3 pt-2 md:block">
          <p className="text-lg font-semibold">OpsMind</p>
          <p className="truncate text-xs text-white/60">{user?.organisationName}</p>
        </div>
        <nav aria-label="Main" className="space-y-1">
          {mainLinks.map((l) => <NavItem key={l.to} {...l} onClick={close} />)}
        </nav>
        {isAdmin && (
          <nav aria-label="Administration" className="mt-5 space-y-1 border-t border-white/15 pt-3">
            {adminLinks.map((l) => <NavItem key={l.to} {...l} onClick={close} />)}
          </nav>
        )}
        <div className="mt-auto border-t border-white/15 pt-3">
          <NavItem to="/settings" label="Account" onClick={close} />
          <p className="truncate px-3 pt-2 text-xs text-white/60">{user?.fullName} ({user?.role})</p>
          <Button variant="secondary" className="mt-2 w-full" onClick={signOut}>Sign out</Button>
        </div>
      </aside>

      <main id="main" className="min-w-0 flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
