import type { SearchEvent, SearchRequest } from "../shared/types.ts";

export async function fetchConfig(): Promise<{ ai: boolean; model: string | null }> {
  const res = await fetch("/api/config");
  return res.json();
}

/** POSTs a search and calls onEvent for each server-sent event until the stream ends. */
export async function streamSearch(body: SearchRequest, onEvent: (e: SearchEvent) => void, signal: AbortSignal) {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Search failed (${res.status})`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      if (data) onEvent(JSON.parse(data));
    }
  }
}
