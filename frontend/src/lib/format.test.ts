import { describe, expect, it } from 'vitest';
import { daysAgo, formatDate, formatMinutes, formatNumber, formatPercent, formatTime, toIsoDate } from './format';

describe('format helpers', () => {
  it('shows an em dash rather than 0 when there is no value', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    expect(formatMinutes(null)).toBe('—');
  });
  it('formats ratios as percentages', () => {
    expect(formatPercent(0.8567)).toBe('85.7%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(1.02, 0)).toBe('102%');
  });
  it('formats minutes as hours and minutes', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(125)).toBe('2 h 05 min');
  });
  it('formats numbers with UK grouping', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
  it('formats calendar dates without timezone drift', () => {
    expect(formatDate('2026-03-01')).toBe('01 Mar 2026');
    expect(formatDate('2026-03-01T00:00:00')).toBe('01 Mar 2026');
  });
  it('trims seconds from times', () => {
    expect(formatTime('06:00:00')).toBe('06:00');
  });
  it('computes local ISO dates', () => {
    const d = new Date(2026, 0, 5);
    expect(toIsoDate(d)).toBe('2026-01-05');
    expect(daysAgo(10, d)).toBe('2025-12-26');
  });
});
