import {
  useEffect, useId, useRef, cloneElement, isValidElement,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { ApiError } from '../api/client';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ---------- Buttons ---------- */

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-dark border-transparent',
  secondary: 'bg-white text-ink border-line hover:bg-paper',
  danger: 'bg-danger text-white border-transparent hover:opacity-90',
  ghost: 'bg-transparent text-accent border-transparent hover:bg-accent-soft',
};

export function Button({
  variant = 'primary', busy = false, className, children, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded border px-3 py-1.5 text-sm font-medium',
        'disabled:cursor-not-allowed disabled:opacity-60', variants[variant], className,
      )}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

/* ---------- Form fields ---------- */

const controlClass =
  'block w-full rounded border border-line bg-white px-2.5 py-1.5 text-sm text-ink placeholder:text-muted/70 ' +
  'aria-[invalid=true]:border-danger disabled:bg-paper';

export function Field({
  label, error, hint, children,
}: { label: string; error?: string; hint?: string; children: ReactElement }) {
  const id = useId();
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy,
      })
    : children;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      {control}
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p id={`${id}-err`} className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(controlClass, className)} />;
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cx(controlClass, className)}>{children}</select>;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(controlClass, className)} />;
}

/* ---------- Feedback states ---------- */

export function Spinner({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', small ? 'h-3.5 w-3.5' : 'h-5 w-5')}
    />
  );
}

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted">
      <Spinner /> <span>{label}…</span>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-line bg-white p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  const trace = error instanceof ApiError ? error.traceId : undefined;
  return (
    <div role="alert" className="rounded border border-danger/30 bg-danger-soft p-4 text-sm">
      <p className="font-medium text-danger">Could not load this data</p>
      <p className="mt-1">{error.message}</p>
      {trace && <p className="mt-1 text-xs text-muted">Reference: {trace}</p>}
      {onRetry && <Button variant="secondary" className="mt-3" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success' | 'warn'; children: ReactNode }) {
  const tones = {
    info: 'border-accent/30 bg-accent-soft', error: 'border-danger/30 bg-danger-soft',
    success: 'border-ok/30 bg-ok-soft', warn: 'border-warn/30 bg-warn-soft',
  } as const;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded border px-3 py-2 text-sm', tones[tone])}>
      {children}
    </div>
  );
}

/** Shows the API message for a failed form submission (field errors are shown beside the fields). */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
  const trace = error instanceof ApiError ? error.traceId : undefined;
  return (
    <Banner tone="error">
      {message}
      {trace && <span className="block text-xs text-muted">Reference: {trace}</span>}
    </Banner>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-paper text-muted border-line', ok: 'bg-ok-soft text-ok border-ok/30',
    warn: 'bg-warn-soft text-warn border-warn/30', danger: 'bg-danger-soft text-danger border-danger/30',
  } as const;
  return <span className={cx('inline-block rounded border px-1.5 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

/* ---------- Layout bits ---------- */

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-0.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded border border-line bg-white', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/* ---------- Modal ---------- */

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded border border-line bg-white p-0 text-ink backdrop:bg-ink/40"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id={titleId} className="font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded px-2 text-xl leading-none text-muted hover:bg-paper">×</button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
    </dialog>
  );
}

export function ConfirmDialog({
  title, message, confirmLabel, busy, error, onConfirm, onCancel,
}: { title: string; message: string; confirmLabel: string; busy?: boolean; error?: unknown; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-sm">{message}</p>
      <div className="mt-3"><FormError error={error} /></div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

/* ---------- Tables ---------- */

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'right';
}

export function DataTable<T>({
  columns, rows, rowKey, caption,
}: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; caption: string }) {
  return (
    <div className="overflow-x-auto rounded border border-line bg-white">
      <table className="w-full min-w-max text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line bg-paper text-left text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className={cx('px-3 py-2 font-medium', c.align === 'right' && 'text-right')}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-line last:border-0">
              {columns.map((c) => (
                <td key={c.header} className={cx('px-3 py-2', c.align === 'right' && 'text-right')}>{c.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page, pageSize, totalCount, onPage,
}: { page: number; pageSize: number; totalCount: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(totalCount / pageSize));
  const first = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalCount);
  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm text-muted">
      <span>{first}–{last} of {totalCount}</span>
      <span className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages}</span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </span>
    </nav>
  );
}
