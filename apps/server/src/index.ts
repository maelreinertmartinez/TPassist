import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, ensureDataDirs } from './config';
import { closeDb, openDb } from './db/client';
import { HttpError } from './db/repo';
import { registerRoutes } from './http/routes';
import { startJobWorker } from './jobs/queue';
// Enregistrement des gestionnaires de tâches.
import './jobs/ingest';
import './jobs/linkCorrections';
import './jobs/generateReport';
import './jobs/generateQuiz';
import './jobs/generateEi';

ensureDataDirs();
openDb();

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info', transport: undefined },
  bodyLimit: 20 * 1024 * 1024,
});

await app.register(fastifyMultipart, { limits: { fileSize: 200 * 1024 * 1024, files: 30 } });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) {
    return reply.status(err.status).send({ error: err.message, code: err.code });
  }
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  return reply.status(status).send({ error: err instanceof Error ? err.message : String(err) });
});

await registerRoutes(app);

if (existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist, prefix: '/', wildcard: false });
  // Application monopage : toute route non-API renvoie index.html.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Route inconnue' });
    return reply.type('text/html').sendFile('index.html');
  });
} else {
  app.log.warn(`Front non compilé (${join(config.webDist, 'index.html')} absent) : utilise le serveur Vite en développement.`);
}

startJobWorker();

const shutdown = async () => {
  await app.close();
  closeDb();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `TPassist prêt sur http://localhost:${config.port} — modèle ${config.model}${config.aiMock ? ' (mode simulation)' : ''}, délai de déblocage ${config.unlockDelayMs / 1000}s`,
);
