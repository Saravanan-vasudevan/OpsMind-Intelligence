export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly fieldErrors: Record<string, string[]>;
  readonly traceId?: string;

  constructor(status: number, title: string, message: string, fieldErrors: Record<string, string[]> = {}, traceId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.title = title;
    this.fieldErrors = fieldErrors;
    this.traceId = traceId;
  }

  /** First validation message for a field. Server keys are camelCase; matching ignores case. */
  fieldMessage(field: string): string | undefined {
    const key = Object.keys(this.fieldErrors).find((k) => k.toLowerCase() === field.toLowerCase());
    return key ? this.fieldErrors[key][0] : undefined;
  }
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Called when an authenticated request comes back 401, e.g. because the session expired. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler;
}

interface ProblemBody {
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;
  traceId?: string;
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toApiError(status: number, body: unknown): ApiError {
  const problem = (body ?? {}) as ProblemBody;
  const fallback =
    status === 401 ? 'You are not signed in.' :
    status === 403 ? 'You do not have permission to do this.' :
    status === 404 ? 'The requested item was not found.' :
    status === 429 ? 'Too many attempts. Wait a minute and try again.' :
    'The request failed.';
  const title = problem.title ?? 'Request failed';
  return new ApiError(status, title, problem.detail ?? (problem.errors ? 'Check the highlighted fields.' : fallback), problem.errors, problem.traceId);
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      signal,
      headers: {
        'X-Requested-With': 'OpsMind',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Server unreachable', 'Cannot reach the server. Check your connection and try again.');
  }

  if (response.status === 204) return undefined as T;

  const data = parseBody(await response.text());
  if (!response.ok) {
    const error = toApiError(response.status, data);
    if (response.status === 401 && !path.startsWith('/api/auth/')) unauthorizedHandler?.();
    throw error;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: (path: string) => request<void>('DELETE', path),
};

export function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
