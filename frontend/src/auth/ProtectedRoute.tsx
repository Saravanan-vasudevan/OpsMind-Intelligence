import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { LoadingBlock } from '../components/ui';

/** Requires a signed-in user; otherwise sends the visitor to the login page and remembers where they were going. */
export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingBlock label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

/** Hides admin-only pages from standard users. The API enforces the same rule; this is for usability. */
export function AdminRoute() {
  const { isAdmin } = useAuth();
  if (!isAdmin) {
    return (
      <div role="alert" className="rounded border border-line bg-white p-6">
        <h1 className="text-lg font-semibold">Admin access required</h1>
        <p className="mt-1 text-sm text-muted">Ask an administrator in your organisation if you need this page.</p>
      </div>
    );
  }
  return <Outlet />;
}
