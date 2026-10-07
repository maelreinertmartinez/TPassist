// File de tâches de fond persistée en base : au plus MAX_PARALLEL tâches à la fois, reprise après redémarrage.
// Chaque type de tâche enregistre son gestionnaire (registerJobHandler) : ajouter un type ne modifie pas la file.
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { JobDto, JobType } from '@tpassist/shared';
import { db, newId } from '../db/client';
import { jobs } from '../db/schema';
import { errorText } from '../utils';

/** Tâche telle qu’enregistrée en base. */
export type JobRow = typeof jobs.$inferSelect;

/** Ce qu'une tâche peut faire pendant son exécution. */
export interface JobContext {
  /** Avancement entre 0 et 1, avec un message optionnel affiché à l'utilisateur. */
  progress(progress: number, message?: string): void;
}

type Handler = (job: JobRow, ctx: JobContext) => Promise<void>;

const handlers = new Map<JobType, Handler>();
const MAX_PARALLEL = 2;
let running = 0;
let timer: NodeJS.Timeout | null = null;

/** Associe un gestionnaire à un type de tâche (appelé à l'import de chaque module de tâche). */
export function registerJobHandler(type: JobType, handler: Handler) {
  handlers.set(type, handler);
}

/** Ajoute une tâche à la file et réveille le traitement. */
export function enqueueJob(input: { type: JobType; courseId?: string | null; refId?: string | null; payload?: Record<string, unknown> }): JobRow {
  const row = db
    .insert(jobs)
    .values({
      id: newId(),
      type: input.type,
      courseId: input.courseId ?? null,
      refId: input.refId ?? null,
      payload: input.payload ?? {},
      status: 'queued',
      message: 'En attente…',
    })
    .returning()
    .get();
  kick();
  return row;
}

/** Vrai si un job du même type est déjà en attente/en cours pour cette référence. */
export function hasPendingJob(type: JobType, key: { courseId?: string; refId?: string }) {
  const conds = [eq(jobs.type, type), inArray(jobs.status, ['queued', 'running'])];
  if (key.courseId) conds.push(eq(jobs.courseId, key.courseId));
  if (key.refId) conds.push(eq(jobs.refId, key.refId));
  return Boolean(db.select({ id: jobs.id }).from(jobs).where(and(...conds)).get());
}

/** Relance une tâche en erreur ; undefined si elle n'existe pas ou n'est pas en erreur. */
export function retryJob(id: string): JobRow | undefined {
  const row = db
    .update(jobs)
    .set({ status: 'queued', error: null, progress: 0, message: 'En attente…', updatedAt: Date.now() })
    .where(and(eq(jobs.id, id), eq(jobs.status, 'error')))
    .returning()
    .get();
  kick();
  return row;
}

function update(id: string, patch: Partial<JobRow>) {
  db.update(jobs)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(jobs.id, id))
    .run();
}

function kick() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(pump, 0);
}

function pump() {
  timer = null;
  while (running < MAX_PARALLEL) {
    const next = db.select().from(jobs).where(eq(jobs.status, 'queued')).orderBy(asc(jobs.createdAt)).limit(1).get();
    if (!next) break;
    const handler = handlers.get(next.type);
    if (!handler) {
      update(next.id, { status: 'error', error: `Type de tâche inconnu : ${next.type}` });
      continue;
    }
    update(next.id, { status: 'running', attempts: next.attempts + 1, message: 'Démarrage…' });
    running++;
    const ctx: JobContext = {
      progress: (progress, message) => update(next.id, { progress: Math.max(0, Math.min(1, progress)), ...(message ? { message } : {}) }),
    };
    handler({ ...next, status: 'running' }, ctx)
      .then(() => update(next.id, { status: 'done', progress: 1, message: 'Terminé' }))
      .catch((err: unknown) => {
        console.error(`[job ${next.type} ${next.id}]`, err);
        update(next.id, { status: 'error', error: errorText(err), message: 'Échec' });
      })
      .finally(() => {
        running--;
        kick();
      });
  }
}

/** Démarre le traitement de la file (les tâches interrompues par un arrêt repartent). */
export function startJobWorker() {
  // Les jobs interrompus par un redémarrage repartent.
  db.update(jobs).set({ status: 'queued', message: 'Reprise après redémarrage…' }).where(eq(jobs.status, 'running')).run();
  kick();
  // Filet de sécurité.
  setInterval(() => kick(), 5_000).unref();
}

/** Tâche telle que l'affiche le front. */
export function jobDto(j: JobRow): JobDto {
  return { id: j.id, type: j.type, status: j.status, progress: j.progress, message: j.message, error: j.error, refId: j.refId, createdAt: j.createdAt, updatedAt: j.updatedAt };
}
