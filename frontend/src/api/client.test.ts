import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, queryString, setUnauthorizedHandler } from './client';

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); setUnauthorizedHandler(null); });

describe('api client', () => {
  it('sends the CSRF header and same-origin credentials', async () => {
    const fetch = mockFetch(200, { ok: true });
    await api.get('/api/plants');
    const [, init] = fetch.mock.calls[0];
    expect(init.credentials).toBe('same-origin');
    expect(init.headers['X-Requested-With']).toBe('OpsMind');
  });

  it('sends JSON bodies with a content type', async () => {
    const fetch = mockFetch(200, {});
    await api.post('/api/plants', { name: 'A' });
    const [, init] = fetch.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"name":"A"}');
  });

  it('returns undefined for 204', async () => {
    mockFetch(204);
    await expect(api.delete('/api/plants/1')).resolves.toBeUndefined();
  });

  it('turns a ProblemDetails validation response into an ApiError with field messages', async () => {
    mockFetch(400, { title: 'Validation', errors: { code: ['Code is required'] }, traceId: 'abc' });
    const error = await api.post('/api/plants', {}).catch((e) => e as ApiError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.fieldMessage('Code')).toBe('Code is required');
    expect(error.traceId).toBe('abc');
  });

  it('uses the server detail message when present', async () => {
    mockFetch(409, { title: 'Conflict', detail: 'That asset code already exists.' });
    const error = await api.post('/api/equipment', {}).catch((e) => e as ApiError);
    expect(error.message).toBe('That asset code already exists.');
  });

  it('notifies the unauthorised handler on 401 for non-auth routes only', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(401, { title: 'Unauthorized' });
    await api.get('/api/plants').catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
    mockFetch(401, { title: 'Unauthorized' });
    await api.post('/api/auth/login', {}).catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reports an unreachable server clearly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const error = await api.get('/api/plants').catch((e) => e as ApiError);
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/cannot reach the server/i);
  });

  it('builds query strings and skips empty values', () => {
    expect(queryString({ a: '1', b: undefined, c: '', d: 0 })).toBe('?a=1&d=0');
    expect(queryString({})).toBe('');
  });
});
