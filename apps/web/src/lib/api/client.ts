import { useAuthStore, getAccessToken } from '@/lib/store/auth-store';

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  status: number;
  code?: string;
  body?: unknown;

  constructor(status: number, message: string, code?: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON body — serialized automatically. */
  body?: unknown;
  /** Attach the access token (default: true). */
  auth?: boolean;
  /** Use the participant token instead of the user access token. */
  participant?: boolean;
  /** Skip the automatic refresh-on-401 retry (used by refresh itself). */
  skipRefresh?: boolean;
  /** Override the access token (used right after a refresh). */
  token?: string | null;
}

let refreshPromise: Promise<string | null> | null = null;

/**
 * Calls POST /auth/refresh. The refresh token lives in an httpOnly cookie,
 * so we only need credentials:'include'. On success the new access token is
 * stored and returned. Concurrent callers share a single in-flight refresh.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        useAuthStore.getState().clear();
        return null;
      }
      const data = (await res.json()) as {
        accessToken: string;
        user?: import('@lms/shared').PublicUser;
      };
      const store = useAuthStore.getState();
      store.setAccessToken(data.accessToken);
      if (data.user) store.setUser(data.user);
      return data.accessToken;
    } catch {
      useAuthStore.getState().clear();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function buildHeaders(opts: RequestOptions, token: string | null): Headers {
  const headers = new Headers(opts.headers);
  if (opts.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (opts.auth !== false && token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  const ctype = res.headers.get('Content-Type') ?? '';
  if (ctype.includes('application/json')) {
    return JSON.parse(text) as T;
  }
  return text as unknown as T;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = undefined;
  let message = `Request failed with status ${res.status}`;
  let code: string | undefined;
  try {
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
        const b = body as { message?: string | string[]; error?: string };
        if (Array.isArray(b.message)) message = b.message.join(', ');
        else if (typeof b.message === 'string') message = b.message;
        else if (typeof b.error === 'string') message = b.error;
        if (typeof b.message === 'string') code = b.message;
      } catch {
        message = text;
      }
    }
  } catch {
    /* ignore */
  }
  return new ApiError(res.status, message, code, body);
}

export async function request<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const isAbsolute = /^https?:\/\//.test(path);
  const url = isAbsolute ? path : `${API_URL}${path}`;

  const token =
    opts.token !== undefined
      ? opts.token
      : opts.participant
        ? useAuthStore.getState().participantToken
        : getAccessToken();

  const headers = buildHeaders(opts, token);

  // Keep only standard RequestInit fields; our custom options (auth,
  // participant, skipRefresh, token, body, headers) are handled explicitly.
  const init: RequestInit = {
    method: opts.method,
    mode: opts.mode,
    cache: opts.cache,
    redirect: opts.redirect,
    referrer: opts.referrer,
    referrerPolicy: opts.referrerPolicy,
    integrity: opts.integrity,
    keepalive: opts.keepalive,
    signal: opts.signal,
    headers,
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };

  let res = await fetch(url, init);

  // Auto-refresh on 401 for user-authenticated requests.
  if (
    res.status === 401 &&
    opts.auth !== false &&
    !opts.participant &&
    !opts.skipRefresh
  ) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      const retryHeaders = buildHeaders(opts, newToken);
      res = await fetch(url, { ...init, headers: retryHeaders });
    }
  }

  if (!res.ok) {
    throw await toApiError(res);
  }

  return parseResponse<T>(res);
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  del: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};

export type { RequestOptions };
