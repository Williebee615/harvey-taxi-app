// HTTP client for the existing Harvey Taxi API. The driver session token
// goes in x-driver-token (the header the server already accepts); the
// server decides who the driver is and what they may do.
import { API_BASE } from './config';

export class ApiError extends Error {
  constructor(message, { status = 0, data = null } = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const REQUEST_TIMEOUT_MS = 15000;

export function createApi({ base = API_BASE, getToken, onUnauthorized, fetchImpl = (...a) => fetch(...a), timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  async function request(method, path, body) {
    const token = getToken ? await getToken() : null;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { 'x-driver-token': token } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller ? controller.signal : undefined
      });
    } catch (err) {
      throw new ApiError(err && err.name === 'AbortError' ? 'The request timed out. Check your connection.' : "Can't reach Harvey Taxi. Check your connection.", { status: 0 });
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.status === 401 && token && onUnauthorized) onUnauthorized();
    if (!res.ok || (data && data.ok === false)) {
      throw new ApiError((data && (data.error || data.message)) || `Request failed (${res.status}).`, { status: res.status, data });
    }
    return data || {};
  }

  return {
    request,
    get: (path) => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    del: (path, body = {}) => request('DELETE', path, body)
  };
}
