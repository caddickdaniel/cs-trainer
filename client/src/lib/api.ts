// Same-origin JSON API client. Mutations carry the session's CSRF token.

export class ApiError extends Error {
  status: number;
  code?: string;
  body: Record<string, unknown>;

  constructor(status: number, message: string, code: string | undefined, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }

  get issues(): { path: string; message: string }[] {
    return (this.body.issues as { path: string; message: string }[]) ?? [];
  }
}

let csrfToken: string | null = null;
const listeners = new Set<() => void>();

export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};

// Notified when the server says the session is gone (401).
export const onUnauthenticated = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

async function refreshCsrf() {
  try {
    const res = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
    const data = await res.json();
    csrfToken = data.csrf_token;
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.', 'network', {});
  }
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const mutating = method !== 'GET';
  if (mutating) {
    if (!csrfToken) await refreshCsrf();
    headers['X-CSRF-Token'] = csrfToken as string;
    headers['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: mutating ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.', 'network', {});
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 403 && data.code === 'csrf_invalid' && retry) {
      await refreshCsrf();
      return request<T>(method, path, body, false);
    }
    if (res.status === 401 && !path.startsWith('/auth/')) listeners.forEach((fn) => fn());
    throw new ApiError(res.status, (data.message as string) || res.statusText, data.code as string | undefined, data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export const errorMessage = (err: unknown) => {
  if (err instanceof ApiError) {
    if (err.issues.length) return `${err.message}: ${err.issues.map((i) => (i.path ? `${i.path} – ${i.message}` : i.message)).join('; ')}`;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
};
