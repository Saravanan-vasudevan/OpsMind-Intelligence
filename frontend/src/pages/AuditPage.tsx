import { useState } from 'react';
import { auditLogs } from '../api/endpoints';
import { useAsync } from '../lib/useAsync';
import { formatDateTime } from '../lib/format';
import { DataTable, EmptyState, ErrorState, Field, Input, LoadingBlock, PageHeader, Pagination } from '../components/ui';

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const list = useAsync(() => auditLogs.list({ action: action.trim() || undefined, page, pageSize: 25 }), [page, action]);
  return (
    <>
      <PageHeader title="Audit log" description="Who changed what. Entries are written by the API and cannot be edited here." />
      <div className="mb-4 w-64"><Field label="Filter by action"><Input value={action} placeholder="e.g. login" onChange={(e) => { setAction(e.target.value); setPage(1); }} /></Field></div>
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <LoadingBlock /> : list.data && list.data.totalCount === 0 ? <EmptyState title="No audit entries match" /> : list.data && (
        <>
          <DataTable caption="Audit log" rows={list.data.items} rowKey={(a) => String(a.id)} columns={[
            { header: 'When', cell: (a) => formatDateTime(a.createdAt.endsWith('Z') ? a.createdAt : `${a.createdAt}Z`) },
            { header: 'User', cell: (a) => a.userName ?? '—' }, { header: 'Action', cell: (a) => a.action },
            { header: 'Entity', cell: (a) => a.entity }, { header: 'Details', cell: (a) => <span className="block max-w-md truncate" title={a.details ?? ''}>{a.details ?? '—'}</span> },
            { header: 'IP', cell: (a) => a.ipAddress ?? '—' },
          ]} />
          <Pagination page={list.data.page} pageSize={list.data.pageSize} totalCount={list.data.totalCount} onPage={setPage} />
        </>
      )}
    </>
  );
}
