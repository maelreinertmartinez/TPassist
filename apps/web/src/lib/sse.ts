import { ApiError } from './api';

export interface SseHandlers<T> {
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

/**
 * Envoie une requête POST et lit la réponse en Server-Sent Events.
 * Résout avec la charge de l'événement `done`, rejette sur `error`.
 */
export async function postSse<T>(url: string, body: unknown, handlers: SseHandlers<T> = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal: handlers.signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Erreur ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
    } catch {
      // ignore
    }
    throw new ApiError(msg, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | undefined;
  let failure: ApiError | undefined;

  const handleEvent = (raw: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    const data = JSON.parse(dataLines.join('\n'));
    if (event === 'delta') handlers.onDelta?.(data.text);
    else if (event === 'done') result = data as T;
    else if (event === 'error') failure = new ApiError(data.message, data.status ?? 500, data.code);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      handleEvent(chunk);
    }
  }
  if (buffer.trim()) handleEvent(buffer);
  if (failure) throw failure;
  if (result === undefined) throw new ApiError('Réponse interrompue.', 500);
  return result;
}
