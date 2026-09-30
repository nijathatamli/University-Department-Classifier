/**
 * Single API client for the whole frontend. No component talks to fetch()
 * directly — error shapes, credentials and JSON handling live here only.
 */
const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details || {};
  }
  /** Field-level errors from the backend validator, for inline form display. */
  get fields() {
    return this.details.fields || {};
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }

  if (response.status === 204) return null;

  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }

  if (!response.ok) {
    const err = payload?.error;
    throw new ApiError(
      response.status,
      err?.code || 'UNKNOWN',
      err?.message || 'Something went wrong. Please try again.',
      err?.details,
    );
  }
  return payload;
}

const qs = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const api = {
  auth: {
    register: (b) => request('/auth/register', { method: 'POST', body: b }),
    login: (b) => request('/auth/login', { method: 'POST', body: b }),
    logout: () => request('/auth/logout', { method: 'POST' }),
    me: () => request('/auth/me'),
    forgotPassword: (b) => request('/auth/forgot-password', { method: 'POST', body: b }),
    resetPassword: (b) => request('/auth/reset-password', { method: 'POST', body: b }),
    changePassword: (b) => request('/auth/change-password', { method: 'POST', body: b }),
  },
  profile: {
    get: () => request('/profile'),
    update: (b) => request('/profile', { method: 'PATCH', body: b }),
  },
  requests: {
    create: (b) => request('/requests', { method: 'POST', body: b }),
    mine: (p) => request('/requests' + qs(p)),
    get: (id) => request(`/requests/${encodeURIComponent(id)}`),
    setStatus: (id, status) =>
      request(`/requests/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } }),
  },
  departments: {
    list: () => request('/departments'),
    get: (idOrSlug) => request(`/departments/${encodeURIComponent(idOrSlug)}`),
  },
  department: {
    me: () => request('/department/me'),
    requests: (p) => request('/department/requests' + qs(p)),
    stats: () => request('/department/stats'),
  },
  model: {
    info: () => request('/model/info'),
    health: () => request('/model/health'),
  },
  contact: {
    send: (b) => request('/contact', { method: 'POST', body: b }),
  },
  admin: {
    stats: () => request('/admin/stats'),
    requests: (p) => request('/admin/requests' + qs(p)),
    users: (p) => request('/admin/users' + qs(p)),
    updateUser: (id, b) => request(`/admin/users/${id}`, { method: 'PATCH', body: b }),
    departments: () => request('/admin/departments'),
    createDepartment: (b) => request('/admin/departments', { method: 'POST', body: b }),
    updateDepartment: (id, b) => request(`/admin/departments/${id}`, { method: 'PATCH', body: b }),
    models: () => request('/admin/models'),
    contacts: (p) => request('/admin/contacts' + qs(p)),
    updateContact: (id, b) => request(`/admin/contacts/${id}`, { method: 'PATCH', body: b }),
    audit: (p) => request('/admin/audit' + qs(p)),
  },
};
