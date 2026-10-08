// Routes HTTP de l'API : elles lisent la requête, valident ce qui doit l'être et délèguent aux services.
// Aucune règle métier ici ; les erreurs levées par les services (HttpError) sont traduites par src/index.ts.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { HELP_KINDS, type AddUnitFromPagesBody, type AiHealth, type HelpKind, type SessionMode, type SubmitAttemptBody, type UnitKind, type WeakPointStatus } from '@tpassist/shared';
import { authSource, pingAi } from '../ai/agent';
import { config } from '../config';
import { db } from '../db/client';
import { findById } from '../db/repo';
import { attempts, documents } from '../db/schema';
import { HttpError, notFound } from '../errors';
import { enqueueJob, jobDto, retryJob } from '../jobs/queue';
import { pageImagePath } from '../pdf/render';
import * as chat from '../services/chat';
import * as coursesSvc from '../services/courses';
import * as documentsSvc from '../services/documents';
import * as editor from '../services/editor';
import { imageMediaType } from '../services/images';
import * as notionsSvc from '../services/notions';
import * as quiz from '../services/quiz';
import * as reportsSvc from '../services/reports';
import * as sessionsSvc from '../services/sessions';
import { usageStats } from '../services/usage';
import { deleteWeakPoint, setWeakPointStatus } from '../services/weakPoints';
import { streamSse } from './sse';

type Params = Record<string, string>;

/** Le résultat du test de connexion à l'IA est gardé 10 minutes (sauf demande explicite de revérification). */
const HEALTH_TTL_MS = 10 * 60 * 1000;
const WEAK_POINT_STATUSES: WeakPointStatus[] = ['active', 'mastered', 'resolved'];
const OK = { ok: true } as const;

let healthCache: AiHealth | null = null;

/** Envoie un fichier du disque ; 404 « <label> introuvable » s'il n'existe pas. */
function sendFile(reply: FastifyReply, path: string | null | undefined, type: string, label: string) {
  if (!path || !existsSync(path)) notFound(label);
  return reply.type(type).send(createReadStream(path));
}

/** Enregistre toutes les routes de l'API sur l'application Fastify. */
export async function registerRoutes(app: FastifyInstance) {
  // ---------- Santé / consommation ----------

  /** Utilisée par le contrôle de santé Docker. */
  app.get('/api/health', async () => OK);

  app.get<{ Querystring: { refresh?: string } }>('/api/health/ai', async (req) => {
    if (healthCache && req.query.refresh !== '1' && Date.now() - healthCache.checkedAt < HEALTH_TTL_MS) return healthCache;
    const r = await pingAi();
    healthCache = { ok: r.ok, message: r.message, mock: config.aiMock, model: config.model, authSource: authSource(), checkedAt: Date.now() };
    return healthCache;
  });

  /** `from` : début de période (ms, 0 = tout) ; `tz` : Date#getTimezoneOffset du navigateur. */
  app.get<{ Querystring: { from?: string; tz?: string } }>('/api/usage/stats', async (req) => {
    const from = Number(req.query.from ?? 0);
    const tz = Number(req.query.tz ?? 0);
    if (!Number.isFinite(from) || !Number.isFinite(tz) || Math.abs(tz) > 14 * 60) throw new HttpError(400, 'Paramètres invalides.');
    return usageStats(from, tz);
  });

  // ---------- Cours ----------

  app.get('/api/courses', async () => coursesSvc.listCourses());
  app.post<{ Body: { name: string; color?: string; icon?: string } }>('/api/courses', async (req) =>
    coursesSvc.createCourse(req.body?.name ?? '', req.body?.color, req.body?.icon),
  );
  app.get<{ Params: Params }>('/api/courses/:id', async (req) => coursesSvc.getCourseDetail(req.params.id));
  app.patch<{ Params: Params; Body: { name?: string; color?: string; icon?: string } }>('/api/courses/:id', async (req) => coursesSvc.updateCourse(req.params.id, req.body ?? {}));
  app.delete<{ Params: Params }>('/api/courses/:id', async (req) => {
    await coursesSvc.deleteCourse(req.params.id);
    return OK;
  });

  /** Ajout de fichiers (multipart, plusieurs PDF). */
  app.post<{ Params: Params }>('/api/courses/:id/documents', async (req) => {
    const created = [];
    for await (const part of req.files()) {
      created.push(await documentsSvc.addDocument(req.params.id, part.filename || 'document.pdf', await part.toBuffer()));
    }
    if (created.length === 0) throw new HttpError(400, 'Aucun fichier reçu.');
    return created;
  });

  app.post<{ Params: Params; Body: { size?: string } }>('/api/courses/:id/quizzes', async (req) =>
    quiz.createCourseQuiz(req.params.id, (req.body?.size as quiz.CourseQuizSize) ?? 'court'),
  );

  app.post<{ Params: Params; Body: { difficulty?: string; sectionIds?: string[] } }>('/api/courses/:id/generate-ei', async (req) =>
    jobDto(
      enqueueJob({
        type: 'generate_ei',
        courseId: req.params.id,
        refId: req.params.id,
        payload: { difficulty: req.body?.difficulty ?? 'standard', sectionIds: req.body?.sectionIds ?? [] },
      }),
    ),
  );

  app.get<{ Params: Params }>('/api/courses/:id/notions', async (req) => notionsSvc.getNotionMap(req.params.id));
  app.post<{ Params: Params }>('/api/courses/:id/notions/generate', async (req) => notionsSvc.requestNotionMap(req.params.id));
  app.get<{ Params: Params }>('/api/notions/:id', async (req) => notionsSvc.getNotionDetail(req.params.id));
  app.post<{ Params: Params; Body: { refresh?: boolean } }>('/api/notions/:id/detail', async (req, reply) => {
    await streamSse(reply, (onText) => notionsSvc.streamNotionDetail(req.params.id, Boolean(req.body?.refresh), onText));
  });

  app.get<{ Params: Params }>('/api/courses/:id/chat', async (req) => chat.courseThread(req.params.id));

  // ---------- Documents ----------

  app.get<{ Params: Params }>('/api/documents/:id/file', async (req, reply) => {
    const doc = findById(documents, req.params.id, 'Document');
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`);
    return sendFile(reply, doc.path, 'application/pdf', 'Document');
  });
  /** Rendu d'une page ; `size=thumb` : miniature (grille des pages). */
  app.get<{ Params: Params; Querystring: { size?: string } }>('/api/documents/:id/pages/:page', async (req, reply) => {
    const page = Number.parseInt(req.params.page, 10);
    if (!Number.isFinite(page)) notFound('Page');
    reply.header('Cache-Control', 'public, max-age=86400');
    return sendFile(reply, pageImagePath(req.params.id, page, req.query.size === 'thumb' ? 'thumb' : 'full'), 'image/png', 'Page');
  });
  app.get<{ Params: Params }>('/api/documents/:id/sessions-count', async (req) => documentsSvc.documentSessionsCount(req.params.id));
  app.post<{ Params: Params; Body: Partial<AddUnitFromPagesBody> }>('/api/documents/:id/units', async (req) => documentsSvc.addUnitFromPages(req.params.id, req.body ?? {}));
  app.post<{ Params: Params }>('/api/documents/:id/reanalyze', async (req) => documentsSvc.reanalyzeDocument(req.params.id));
  app.delete<{ Params: Params }>('/api/documents/:id', async (req) => {
    await documentsSvc.deleteDocument(req.params.id);
    return OK;
  });

  // ---------- Tâches ----------

  app.post<{ Params: Params }>('/api/jobs/:id/retry', async (req) => jobDto(retryJob(req.params.id) ?? notFound('Tâche en erreur')));

  // ---------- Éditeur ----------

  app.get<{ Params: Params }>('/api/units/:id/editor', async (req) => editor.getEditorUnit(req.params.id));
  app.patch<{ Params: Params; Body: { title?: string; kind?: UnitKind; pageStart?: number | null; pageEnd?: number | null; durationMinutes?: number | null } }>(
    '/api/units/:id',
    async (req) => editor.updateUnit(req.params.id, req.body ?? {}),
  );
  app.delete<{ Params: Params }>('/api/units/:id', async (req) => {
    editor.deleteUnit(req.params.id);
    return OK;
  });
  app.post<{ Params: Params; Body: { sourceId: string } }>('/api/units/:id/merge', async (req) => editor.mergeUnits(req.params.id, req.body.sourceId));
  app.post<{ Params: Params }>('/api/units/:id/exercises', async (req) => editor.addExercise(req.params.id));
  app.post<{ Params: Params; Body: { targetUnitId: string | null; matches?: { solutionIndex: number; questionId: string }[] } }>(
    '/api/units/:id/link-corrige',
    async (req) => editor.linkCorrige(req.params.id, req.body.targetUnitId, req.body.matches),
  );
  app.patch<{ Params: Params; Body: { title?: string; contextMd?: string } }>('/api/exercises/:id', async (req) => editor.updateExercise(req.params.id, req.body ?? {}));
  app.delete<{ Params: Params }>('/api/exercises/:id', async (req) => editor.deleteExercise(req.params.id));
  app.post<{ Params: Params }>('/api/exercises/:id/questions', async (req) => editor.addQuestion(req.params.id));
  app.patch<{ Params: Params; Body: Parameters<typeof editor.updateQuestion>[1] }>('/api/questions/:id', async (req) => editor.updateQuestion(req.params.id, req.body ?? {}));
  app.delete<{ Params: Params }>('/api/questions/:id', async (req) => editor.deleteQuestion(req.params.id));
  app.patch<{ Params: Params; Body: { title?: string; summary?: string; contentMd?: string } }>('/api/sections/:id', async (req) => editor.updateSection(req.params.id, req.body ?? {}));

  // ---------- Séances ----------

  app.post<{ Params: Params; Body: { mode?: SessionMode; timeLimitMinutes?: number | null } }>('/api/units/:id/sessions', async (req) => {
    const minutes = req.body?.timeLimitMinutes;
    const s = sessionsSvc.createSession(req.params.id, req.body?.mode ?? 'tp', minutes ? Math.round(minutes * 60) : null);
    return { id: s.id };
  });
  app.get<{ Params: Params }>('/api/sessions/:id', async (req) => sessionsSvc.getSessionState(req.params.id));
  app.post<{ Params: Params; Body: { questionId: string | null; visible: boolean } }>('/api/sessions/:id/heartbeat', async (req) =>
    sessionsSvc.heartbeat(req.params.id, req.body?.questionId ?? null, Boolean(req.body?.visible)),
  );
  app.post<{ Params: Params; Body: { questionId: string; kind: HelpKind } }>('/api/sessions/:id/help', async (req, reply) => {
    const { questionId, kind } = req.body ?? ({} as { questionId: string; kind: HelpKind });
    if (!HELP_KINDS.includes(kind)) throw new HttpError(400, 'Aide inconnue.');
    await streamSse(reply, (onText) => sessionsSvc.requestHelp(req.params.id, questionId, kind, onText));
  });
  app.post<{ Params: Params; Body: SubmitAttemptBody }>('/api/sessions/:id/attempts', async (req) => sessionsSvc.submitAttempt(req.params.id, req.body));
  app.post<{ Params: Params; Body: { what: 'location' | 'explanation' } }>('/api/sessions/:id/attempts/:attemptId/reveal', async (req) =>
    sessionsSvc.revealError(req.params.id, req.params.attemptId, req.body?.what === 'explanation' ? 'explanation' : 'location'),
  );
  app.post<{ Params: Params; Body: { questionId: string; struggled?: boolean | null; skip?: boolean } }>('/api/sessions/:id/close-question', async (req) =>
    sessionsSvc.closeQuestion(req.params.id, req.body.questionId, req.body.struggled, { skip: Boolean(req.body.skip) }),
  );
  app.post<{ Params: Params }>('/api/sessions/:id/advance', async (req) => sessionsSvc.advance(req.params.id));
  app.post<{ Params: Params; Body: { questionId: string } }>('/api/sessions/:id/goto', async (req) => sessionsSvc.gotoQuestion(req.params.id, req.body.questionId));
  app.post<{ Params: Params }>('/api/sessions/:id/finish', async (req) => {
    sessionsSvc.finishSession(req.params.id);
    return sessionsSvc.getSessionState(req.params.id);
  });
  app.post<{ Params: Params }>('/api/sessions/:id/report/retry', async (req) => reportsSvc.retryReport(req.params.id));
  app.post<{ Params: Params }>('/api/sessions/:id/review-quiz', async (req) => quiz.createReviewQuiz(req.params.id));
  app.get<{ Params: Params }>('/api/sessions/:id/chat', async (req) => chat.sessionThread(req.params.id));

  app.get<{ Params: Params }>('/api/attempts/:id/image', async (req, reply) => {
    const path = db.select({ p: attempts.imagePath }).from(attempts).where(eq(attempts.id, req.params.id)).get()?.p;
    return sendFile(reply, path, imageMediaType(path ?? ''), 'Image');
  });

  app.get<{ Params: Params }>('/api/reports/:id', async (req) => reportsSvc.getReport(req.params.id));

  // ---------- Quiz ----------

  app.get<{ Params: Params }>('/api/quizzes/:id', async (req) => quiz.getQuiz(req.params.id));
  app.post<{ Params: Params; Body: { choice?: number | null; text?: string | null } }>('/api/quizzes/:id/items/:itemId/answer', async (req) =>
    quiz.answerItem(req.params.id, req.params.itemId, req.body ?? {}),
  );
  app.post<{ Params: Params }>('/api/quizzes/:id/restart', async (req) => quiz.restartQuiz(req.params.id));
  app.post<{ Params: Params }>('/api/quizzes/:id/retry', async (req) => quiz.retryQuizGeneration(req.params.id));

  // ---------- Points bloquants ----------

  app.patch<{ Params: Params; Body: { status: WeakPointStatus } }>('/api/weak-points/:id', async (req) => {
    if (!WEAK_POINT_STATUSES.includes(req.body?.status)) throw new HttpError(400, 'Statut invalide.');
    setWeakPointStatus(req.params.id, req.body.status);
    return OK;
  });
  app.delete<{ Params: Params }>('/api/weak-points/:id', async (req) => {
    deleteWeakPoint(req.params.id);
    return OK;
  });

  // ---------- Chat ----------

  app.post<{ Params: Params; Body: { text: string; imageDataUrl?: string | null } }>('/api/chat/threads/:id/messages', async (req, reply) => {
    await streamSse(reply, (onText) => chat.sendMessage(req.params.id, req.body ?? { text: '' }, onText));
  });
  app.get<{ Params: Params }>('/api/chat/messages/:id/image', async (req, reply) => {
    const path = chat.chatImagePath(req.params.id);
    return sendFile(reply, path, imageMediaType(path ?? ''), 'Image');
  });
}
