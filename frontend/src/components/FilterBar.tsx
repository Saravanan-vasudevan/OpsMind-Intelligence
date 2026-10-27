import type { Filters, Plant } from '../api/types';
import { Field, Input, Select } from './ui';

export function FilterBar({
  filters, plants, onChange,
}: { filters: Filters; plants: Plant[]; onChange: (next: Filters) => void }) {
  return (
    <form className="mb-5 flex flex-wrap items-end gap-3 rounded border border-line bg-white p-3" onSubmit={(e) => e.preventDefault()} aria-label="Filters">
      <div className="w-40"><Field label="From"><Input type="date" value={filters.from ?? ''} max={filters.to} onChange={(e) => onChange({ ...filters, from: e.target.value || undefined })} /></Field></div>
      <div className="w-40"><Field label="To"><Input type="date" value={filters.to ?? ''} min={filters.from} onChange={(e) => onChange({ ...filters, to: e.target.value || undefined })} /></Field></div>
      <div className="w-52">
        <Field label="Plant">
          <Select value={filters.plantId ?? ''} onChange={(e) => onChange({ ...filters, plantId: e.target.value || undefined })}>
            <option value="">All plants</option>
            {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      </div>
    </form>
  );
}
