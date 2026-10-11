import type { DayResponse, HistoryItem, HomeResponse, Role, ScheduleResponse, Session } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as { error?: string }) : {};
  if (!response.ok) throw new ApiError(data.error || 'Something went wrong.', response.status);
  return data as T;
}

export const api = {
  session: () => request<Session>('/api/session'),
  setTimezone: (timezone: string) =>
    request<{ ok: true }>('/api/settings/timezone', { method: 'PUT', body: JSON.stringify({ timezone }) }),
  claimRole: (role: Role) =>
    request<{ ok: true }>('/api/session/role', { method: 'POST', body: JSON.stringify({ role }) }),
  swapRoles: () => request<{ ok: true }>('/api/session/swap', { method: 'POST' }),
  setDevRole: (role: Role) =>
    request<{ ok: true; role: Role }>('/api/dev/role', { method: 'POST', body: JSON.stringify({ role }) }),
  home: () => request<HomeResponse>('/api/home'),
  history: () => request<{ recent: HistoryItem[]; older: HistoryItem[] }>('/api/history'),
  day: (date: string) => request<DayResponse>(`/api/days/${date}`),
  check: (date: string, position: number) =>
    request<{ ok: true }>(`/api/days/${date}/slots/${position}/check`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  uncheck: (date: string, position: number) =>
    request<{ ok: true }>(`/api/days/${date}/slots/${position}/check`, { method: 'DELETE' }),
  comment: (date: string, position: number, comment: string) =>
    request<{ ok: true }>(`/api/days/${date}/slots/${position}`, {
      method: 'PATCH',
      body: JSON.stringify({ comment }),
    }),
  schedule: () => request<ScheduleResponse>('/api/schedule'),
  saveTimes: (times: string[], scope: 'today' | 'forward') =>
    request<ScheduleResponse & { ok: true }>('/api/schedule/times', {
      method: 'PUT',
      body: JSON.stringify({ times, scope }),
    }),
  saveCount: (mealCount: 3 | 5, effectiveDate: string) =>
    request<{ ok: true }>('/api/schedule/count', {
      method: 'PUT',
      body: JSON.stringify({ mealCount, effectiveDate }),
    }),
};
