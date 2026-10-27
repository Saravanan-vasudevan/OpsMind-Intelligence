import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiCard } from './KpiCard';

describe('KpiCard', () => {
  it('renders label, value and detail', () => {
    render(<KpiCard label="Availability" value="91.2%" detail="Unplanned downtime 2 h" />);
    expect(screen.getByText('Availability')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-Availability')).toHaveTextContent('91.2%');
    expect(screen.getByText('Unplanned downtime 2 h')).toBeInTheDocument();
  });
});
