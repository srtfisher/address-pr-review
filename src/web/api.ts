import type { Action, FilePatch, ItemState, ResultStatus, SessionPayload, SessionState, User } from '../shared/schema';

const token = new URLSearchParams(window.location.search).get('token') ?? '';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'x-crf-token': token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `${method} ${path} failed with ${response.status}`);
  }
  return json;
}

export const api = {
  session: () => request<SessionPayload>('GET', '/api/session'),
  updateItem: (id: string, patch: { action?: Action | null; body?: string }) =>
    request<ItemState>('PUT', `/api/items/${encodeURIComponent(id)}`, patch),
  mentions: (query: string) => request<User[]>('GET', `/api/mentions?q=${encodeURIComponent(query)}`),
  preview: (text: string) => request<{ html: string }>('POST', '/api/preview', { text }),
  file: (path: string) => request<FilePatch>('GET', `/api/file?path=${encodeURIComponent(path)}`),
  post: (ids: string[]) => request<SessionState>('POST', '/api/post', { ids }),
  finish: (status: ResultStatus) => request<{ ok: true }>('POST', '/api/finish', { status }),
};
