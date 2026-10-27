import { api, queryString } from './client';
import type {
  AuditLogEntry, Category, DowntimeCategory, DowntimeEvent, DowntimeReasonRow, Equipment, EquipmentStatus, Filters,
  Granularity, KpiSummary, Line, Paged, Plant, PlantComparisonRow, ProductionRecord, Role, Shift, TrendPoint, User,
} from './types';

export const auth = {
  login: (email: string, password: string) => api.post<User>('/api/auth/login', { email, password }),
  register: (body: { organisationName: string; fullName: string; email: string; password: string }) =>
    api.post<User>('/api/auth/register', body),
  logout: () => api.post<void>('/api/auth/logout'),
  me: () => api.get<User>('/api/auth/me'),
  updateProfile: (fullName: string) => api.put<User>('/api/auth/me', { fullName }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<void>('/api/auth/change-password', { currentPassword, newPassword }),
};

export interface PlantInput { name: string; code: string; location: string | null; timeZone: string }
export const plants = {
  list: () => api.get<Plant[]>('/api/plants'),
  get: (id: string) => api.get<Plant>(`/api/plants/${id}`),
  create: (body: PlantInput) => api.post<Plant>('/api/plants', body),
  update: (id: string, body: PlantInput) => api.put<Plant>(`/api/plants/${id}`, body),
  remove: (id: string) => api.delete(`/api/plants/${id}`),
};

export interface LineInput { plantId: string; name: string; code: string }
export const lines = {
  list: (plantId?: string) => api.get<Line[]>(`/api/lines${queryString({ plantId })}`),
  create: (body: LineInput) => api.post<Line>('/api/lines', body),
  update: (id: string, body: LineInput) => api.put<Line>(`/api/lines/${id}`, body),
  remove: (id: string) => api.delete(`/api/lines/${id}`),
};

export interface ShiftInput { plantId: string; name: string; startTime: string; endTime: string }
export const shifts = {
  list: (plantId?: string) => api.get<Shift[]>(`/api/shifts${queryString({ plantId })}`),
  create: (body: ShiftInput) => api.post<Shift>('/api/shifts', body),
  update: (id: string, body: ShiftInput) => api.put<Shift>(`/api/shifts/${id}`, body),
  remove: (id: string) => api.delete(`/api/shifts/${id}`),
};

export const categories = {
  list: () => api.get<Category[]>('/api/equipment-categories'),
  create: (name: string) => api.post<Category>('/api/equipment-categories', { name }),
  update: (id: string, name: string) => api.put<Category>(`/api/equipment-categories/${id}`, { name }),
  remove: (id: string) => api.delete(`/api/equipment-categories/${id}`),
};

export interface EquipmentInput {
  productionLineId: string;
  categoryId: string;
  assetCode: string;
  name: string;
  idealRatePerHour: number | null;
  commissionedOn: string | null;
  status: EquipmentStatus;
}
export interface EquipmentQuery { plantId?: string; lineId?: string; categoryId?: string; search?: string; page?: number; pageSize?: number }
export const equipment = {
  list: (query: EquipmentQuery = {}) => api.get<Paged<Equipment>>(`/api/equipment${queryString({ ...query })}`),
  create: (body: EquipmentInput) => api.post<Equipment>('/api/equipment', body),
  update: (id: string, body: EquipmentInput) => api.put<Equipment>(`/api/equipment/${id}`, body),
  remove: (id: string) => api.delete(`/api/equipment/${id}`),
};

export interface ProductionInput {
  equipmentId: string;
  shiftId: string;
  shiftDate: string;
  unitsProduced: number;
  targetUnits: number;
  runMinutes: number;
  inspectedUnits: number | null;
  rejectedUnits: number | null;
  defectType: string | null;
  notes: string | null;
}
export interface RecordQuery extends Filters { page?: number; pageSize?: number }
export const production = {
  list: (query: RecordQuery) => api.get<Paged<ProductionRecord>>(`/api/production-records${queryString({ ...query })}`),
  create: (body: ProductionInput) => api.post<ProductionRecord>('/api/production-records', body),
  remove: (id: string) => api.delete(`/api/production-records/${id}`),
};

export interface DowntimeInput {
  equipmentId: string;
  startTime: string;
  endTime: string;
  category: DowntimeCategory;
  reasonCode: string;
  notes: string | null;
}
export interface DowntimeQuery extends Filters { category?: DowntimeCategory; page?: number; pageSize?: number }
export const downtime = {
  list: (query: DowntimeQuery) => api.get<Paged<DowntimeEvent>>(`/api/downtime-events${queryString({ ...query })}`),
  create: (body: DowntimeInput) => api.post<DowntimeEvent>('/api/downtime-events', body),
  remove: (id: string) => api.delete(`/api/downtime-events/${id}`),
};

export const analytics = {
  summary: (filters: Filters, signal?: AbortSignal) => api.get<KpiSummary>(`/api/analytics/summary${queryString({ ...filters })}`, signal),
  trend: (filters: Filters, granularity: Granularity, signal?: AbortSignal) =>
    api.get<TrendPoint[]>(`/api/analytics/trend${queryString({ ...filters, granularity })}`, signal),
  plantComparison: (filters: Filters, signal?: AbortSignal) =>
    api.get<PlantComparisonRow[]>(`/api/analytics/plant-comparison${queryString({ ...filters })}`, signal),
  downtimeReasons: (filters: Filters, signal?: AbortSignal) =>
    api.get<DowntimeReasonRow[]>(`/api/analytics/downtime-reasons${queryString({ ...filters })}`, signal),
};

export const exportsApi = {
  productionCsvUrl: (filters: Filters) => `/api/exports/production-records.csv${queryString({ ...filters })}`,
};

export interface UserInput { fullName: string; email: string; password: string; role: Role }
export const users = {
  list: () => api.get<User[]>('/api/users'),
  create: (body: UserInput) => api.post<User>('/api/users', body),
  update: (id: string, body: { fullName: string; role: Role; isActive: boolean }) => api.put<User>(`/api/users/${id}`, body),
};

export const auditLogs = {
  list: (query: { action?: string; page?: number; pageSize?: number }) =>
    api.get<Paged<AuditLogEntry>>(`/api/audit-logs${queryString({ ...query })}`),
};
