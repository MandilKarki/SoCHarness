import type { Trace } from "./types";
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? { credentials: "same-origin" }
      : {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) {
    if (
      response.status === 401 &&
      !path.startsWith("/api/login") &&
      location.pathname !== "/login"
    )
      location.assign("/login");
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data as T;
}
export async function readNDJSON(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: Trace) => void,
) {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
      if (done) {
        if (buffer.trim()) onEvent(JSON.parse(buffer));
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
export function mergeTrace(current: Trace[], incoming: Trace[]) {
  const events = new Map(current.map((e) => [e.seq, e]));
  for (const e of incoming) events.set(e.seq, e);
  return [...events.values()].sort((a, b) => a.seq - b.seq);
}
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
export function safeLink(value: string | undefined) {
  try {
    const url = new URL(value || "");
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
