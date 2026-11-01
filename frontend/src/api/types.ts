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

/* ---------- V2: imports, intelligence, reliability ---------- */

export type ImportKind = 'production' | 'downtime';
export type ConflictPolicy = 'skip' | 'update';
export type ImportStatus = 'Completed' | 'Rejected' | 'Failed';

export interface ImportBatch {
  id: string;
  kind: ImportKind;
  fileName: string;
  sourceFormat: string;
  conflictPolicy: ConflictPolicy;
  strict: boolean;
  status: ImportStatus;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  skippedRows: number;
  rejectedRows: number;
  errorsTruncated: boolean;
  message: string | null;
  uploadedBy: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ImportRowError {
  rowNumber: number;
  column: string | null;
  code: string;
  message: string;
  rawValue: string | null;
}

/** Response of POST /api/imports. */
export interface ImportResult {
  batchId: string;
  kind: ImportKind;
  fileName: string;
  status: ImportStatus;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  skippedRows: number;
  rejectedRows: number;
  errorsTruncated: boolean;
  message: string;
  alreadyImported: boolean;
  warnings: string[];
  errorsPreview: ImportRowError[];
}

export type ForecastMetric = 'units' | 'unplanned_downtime_minutes';

export interface ForecastModelScore {
  name: string;
  description: string;
  selected: boolean;
  failed: boolean;
  mae: number | null;
  rmse: number | null;
  wape: number | null;
  bias: number | null;
  skillVsSeasonalNaive: number | null;
}

export interface Forecast {
  metric: ForecastMetric;
  scope: { plantId: string | null; plantName: string | null; equipmentId: string | null; assetCode: string | null };
  horizonDays: number;
  selectedModel: string;
  selectedModelDescription: string;
  intervalLevel: number;
  history: Array<{ date: string; value: number }>;
  forecast: Array<{ date: string; point: number; lower: number; upper: number }>;
  backtest: { folds: number; horizonDays: number; strideDays: number; models: ForecastModelScore[] };
  dataQuality: { firstDate: string; lastDate: string; days: number; missingDays: number; droppedToday: boolean; requiredDays: number };
  notes: string[];
}

export type AnomalyMethod = 'robust_z' | 'isolation_forest';
export type AnomalyMetric = 'attainment' | 'defect_rate' | 'downtime_share';

export interface Anomaly {
  equipmentId: string;
  assetCode: string;
  date: string;
  metric: AnomalyMetric;
  value: number;
  baseline: number;
  score: number;
  method: AnomalyMethod;
  explanation: string;
}

export interface AnomalyResponse {
  method: AnomalyMethod;
  from: string;
  to: string;
  parameters: Record<string, number>;
  machineDaysEvaluated: number;
  totalFlags: number;
  returned: number;
  anomalies: Anomaly[];
  notes: string[];
}

export interface DetectorEvaluation {
  [key: string]: number | string | boolean | null | undefined;
}

export interface AnomalyEvaluation {
  dataset: { kind: string; seed: number; days: number; machines: number; evaluatedMachineDays: number; injectedAnomalies: number };
  detectors: Record<string, DetectorEvaluation>;
  limitations: string[];
}

export interface ReliabilityRow {
  equipmentId: string;
  assetCode: string;
  equipmentName: string;
  plantId: string;
  plantName: string;
  lineName: string;
  failures: number;
  unplannedMinutes: number;
  plannedMinutes: number;
  runMinutes: number;
  scheduledMinutes: number;
  mtbfMinutes: number | null;
  mttrMinutes: number | null;
  availability: number | null;
  downtimeRankInPlant: number;
  pctOfPlantUnplanned: number | null;
  cumulativePctOfPlant: number | null;
}
