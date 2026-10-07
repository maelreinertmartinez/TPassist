// Réponses diffusées au fil de l'eau (Server-Sent Events) pour les générations de l'IA.
import type { FastifyReply } from 'fastify';
import { HttpError } from '../errors';
import { errorText } from '../utils';

/**
 * Exécute `run` en diffusant le texte produit en Server-Sent Events :
 * `delta` ({text}) au fil de l'eau, puis `done` (résultat) ou `error` ({message, status}).
 * La génération continue même si le client se déconnecte (le résultat est mis en cache).
 */
export async function streamSse<T>(reply: FastifyReply, run: (onText: (delta: string) => void) => Promise<T>) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: string, data: unknown) => {
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const keepAlive = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(': ping\n\n');
  }, 15_000);
  try {
    const result = await run((text) => send('delta', { text }));
    send('done', result);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = errorText(err);
    if (status >= 500) console.error('[sse]', err);
    send('error', { message, status, code: err instanceof HttpError ? err.code : undefined });
  } finally {
    clearInterval(keepAlive);
    if (!res.writableEnded) res.end();
  }
}
