import type { AppConfig, Filters, ServerEvent, Spec } from "../shared/types.ts";

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  config: () => fetch("/api/config").then((r) => json<AppConfig>(r)),
  createSession: () => fetch("/api/sessions", { method: "POST" }).then((r) => json<{ id: string }>(r)),
  send: (id: string, text: string) =>
    fetch(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }).then((r) => json(r)),
  abort: (id: string) => fetch(`/api/sessions/${id}/abort`, { method: "POST" }).then((r) => json(r)),
  setFilters: (id: string, filters: Filters) =>
    fetch(`/api/sessions/${id}/filters`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(filters),
    }).then((r) => json(r)),
  setSpec: (id: string, spec: Spec) =>
    fetch(`/api/sessions/${id}/spec`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(spec),
    }).then((r) => json(r)),
  events: (id: string, onEvent: (e: ServerEvent) => void, onError: () => void) => {
    const source = new EventSource(`/api/sessions/${id}/events`);
    source.onmessage = (m) => onEvent(JSON.parse(m.data));
    source.onerror = onError;
    return () => source.close();
  },
};
