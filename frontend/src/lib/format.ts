const EMPTY = '—';

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY;
  return new Intl.NumberFormat('en-GB').format(value);
}

/** Ratios from the API are 0..1; null means there was no data to compute them from. */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return EMPTY;
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY;
  const total = Math.round(value);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

export function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function formatTime(value: string): string {
  return value.slice(0, 5);
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function daysAgo(days: number, from = new Date()): string {
  const date = new Date(from);
  date.setDate(date.getDate() - days);
  return toIsoDate(date);
}
