export function KpiCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded border border-line bg-white p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold" data-testid={`kpi-${label}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
    </div>
  );
}
