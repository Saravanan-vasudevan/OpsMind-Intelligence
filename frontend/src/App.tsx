import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminRoute, ProtectedRoute } from './auth/ProtectedRoute';
import { Layout } from './components/Layout';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { OverviewPage } from './pages/OverviewPage';
import { PlantsPage, PlantDetailPage } from './pages/PlantsPages';
import { EquipmentPage } from './pages/EquipmentPage';
import { RecordsPage } from './pages/RecordsPage';
import { UsersPage } from './pages/UsersPage';
import { AuditPage } from './pages/AuditPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<OverviewPage />} />
          <Route path="records" element={<RecordsPage />} />
          <Route path="plants" element={<PlantsPage />} />
          <Route path="plants/:plantId" element={<PlantDetailPage />} />
          <Route path="equipment" element={<EquipmentPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route element={<AdminRoute />}>
            <Route path="users" element={<UsersPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
