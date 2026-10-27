export type Role = 'Admin' | 'User';
export type EquipmentStatus = 'Active' | 'Inactive' | 'Maintenance';
export type DowntimeCategory = 'Planned' | 'Unplanned';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  organisationId: string;
  organisationName: string;
  createdAt: string;
}

export interface Plant {
  id: string;
  name: string;
  code: string;
  location: string | null;
  timeZone: string;
  lineCount: number;
  shiftCount: number;
  equipmentCount: number;
}

export interface Line {
  id: string;
  plantId: string;
  plantName: string;
  name: string;
  code: string;
  equipmentCount: number;
}

export interface Shift {
  id: string;
  plantId: string;
  plantName: string;
  name: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

export interface Category {
  id: string;
  name: string;
  equipmentCount: number;
}

export interface Equipment {
  id: string;
  productionLineId: string;
  lineName: string;
  plantId: string;
  plantName: string;
  categoryId: string;
  categoryName: string;
  assetCode: string;
  name: string;
  idealRatePerHour: number | null;
  commissionedOn: string | null;
  status: EquipmentStatus;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface ProductionRecord {
  id: string;
  equipmentId: string;
  equipmentName: string;
  assetCode: string;
  plantId: string;
  plantName: string;
  lineId: string;
  lineName: string;
  shiftId: string;
  shiftName: string;
  shiftDate: string;
  unitsProduced: number;
  targetUnits: number;
  runMinutes: number;
  inspectedUnits: number | null;
  rejectedUnits: number | null;
  defectType: string | null;
  notes: string | null;
}

export interface DowntimeEvent {
  id: string;
  equipmentId: string;
  equipmentName: string;
  assetCode: string;
  plantName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  category: DowntimeCategory;
  reasonCode: string;
  notes: string | null;
}

export interface KpiSummary {
  recordCount: number;
  totalUnits: number;
  totalTargetUnits: number;
  targetAttainment: number | null;
  scheduledMinutes: number;
  runMinutes: number;
  utilisation: number | null;
  plannedDowntimeMinutes: number;
  unplannedDowntimeMinutes: number;
  availability: number | null;
  inspectedUnits: number;
  rejectedUnits: number;
  defectRate: number | null;
}

export interface TrendPoint {
  date: string;
  units: number;
  targetUnits: number;
  inspectedUnits: number;
  rejectedUnits: number;
  defectRate: number | null;
}

export interface PlantComparisonRow {
  plantId: string;
  plantName: string;
  units: number;
  targetUnits: number;
  targetAttainment: number | null;
  utilisation: number | null;
  availability: number | null;
  unplannedDowntimeMinutes: number;
  defectRate: number | null;
}

export interface DowntimeReasonRow {
  reasonCode: string;
  category: DowntimeCategory;
  minutes: number;
  events: number;
}

export interface AuditLogEntry {
  id: number;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: string | null;
  ipAddress: string | null;
}

export interface Filters {
  from?: string;
  to?: string;
  plantId?: string;
  lineId?: string;
  equipmentId?: string;
}

export type Granularity = 'day' | 'week' | 'month';
