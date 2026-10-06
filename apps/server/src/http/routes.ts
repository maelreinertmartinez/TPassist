import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import { desc, eq, sql } from 'drizzle-orm';
import type { AiHealth, HelpKind, SessionMode, SubmitAttemptBody, UnitKind, UsageSummary } from '@tpassist/shared';
import { authSource, pingAi } from '../ai/agent';
import { config } from '../config';
import { db } from '../db/client';
import { HttpError, notFound } from '../db/repo';
import { aiCalls, attempts, documents, jobs, reports } from '../db/schema';
import { enqueueJob, retryJob } from '../jobs/queue';
import { pageImagePath } from '../pdf/render';
import * as chat from '../services/chat';
import * as coursesSvc from '../services/courses';
import * as editor from '../services/editor';
import * as quiz from '../services/quiz';
import * as sessionsSvc from '../services/sessions';
import { setWeakPointStatus } from '../services/weakPoints';
import { weakPoints } from '../db/schema';
import { streamSse } from './sse';

type Params = Record<string, string>;

let healthCache: AiHealth | null = null;

export async function registerRoutes(app: FastifyInstance) {
  // ---------- Santé / consommation ----------

  app.get('/api/health', async () => ({ ok: true }));

  app.get<{ Querystring: { refresh?: string } }>('/api/health/ai', async (req) => {
    const fresh = req.query.refresh === '1';
    if (healthCache && !fresh && Date.now() - healthCache.checkedAt < 10 * 60 * 1000) return healthCache;
    const r = await pingAi();
    healthCache = { ok: r.ok, message: r.message, mock: config.aiMock, model: config.model, authSource: authSource(), checkedAt: Date.now() };
    return healthCache;
  });

  app.get('/api/usage', async (): Promise<UsageSummary> => {
    const rows = db
      .select({ task: aiCalls.task, calls: sql<number>`count(*)`, costUsd: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)` })
      .from(aiCalls)
      .groupBy(aiCalls.task)
      .all();
    return {
      calls: rows.reduce((a, r) => a + Number(r.calls), 0),
      costUsd: rows.reduce((a, r) => a + Number(r.costUsd), 0),
      byTask: rows.map((r) => ({ task: r.task, calls: Number(r.calls), costUsd: Number(r.costUsd) })).sort((a, b) => b.costUsd - a.costUsd),
    };
  });

  // ---------- Cours ----------

  app.get('/api/courses', async () => coursesSvc.listCourses());
  app.post<{ Body: { name: string; color?: string } }>('/api/courses', async (req) => coursesSvc.createCourse(req.body?.name ?? '', req.body?.color));
  app.get<{ Params: Params }>('/api/courses/:id', async (req) => coursesSvc.getCourseDetail(req.params.id));
  app.patch<{ Params: Params; Body: { name?: string; color?: string } }>('/api/courses/:id', async (req) => coursesSvc.updateCourse(req.params.id, req.body ?? {}));
  app.delete<{ Params: Params }>('/api/courses/:id', async (req) => {
    await coursesSvc.deleteCourse(req.params.id);
    return { ok: true };
  });

  // Ajout de fichiers (multipart, plusieurs PDF).
  app.post<{ Params: Params }>('/api/courses/:id/documents', async (req) => {
    const created = [];
    for await (const part of req.files()) {
      const buf = await part.toBuffer();
      created.push(await coursesSvc.addDocument(req.params.id, part.filename || 'document.pdf', buf));
    }
    if (created.length === 0) throw new HttpError(400, 'Aucun fichier reçu.');
    return created;
  });

  app.post<{ Params: Params; Body: { size?: string } }>('/api/courses/:id/quizzes', async (req) =>
    quiz.createCourseQuiz(req.params.id, (req.body?.size as quiz.CourseQuizSize) ?? 'court'),
  );

  app.post<{ Params: Params; Body: { difficulty?: string; sectionIds?: string[] } }>('/api/courses/:id/generate-ei', async (req) => {
    const job = enqueueJob({
      type: 'generate_ei',
      courseId: req.params.id,
      refId: req.params.id,
      payload: { difficulty: req.body?.difficulty ?? 'standard', sectionIds: req.body?.sectionIds ?? [] },
    });
    return coursesSvc.jobDto(job);
  });

  app.get<{ Params: Params }>('/api/courses/:id/chat', async (req) => {
    const t = chat.getOrCreateThread('course', req.params.id);
    return chat.getThread(t.id);
  });

  // ---------- Documents ----------

  app.get<{ Params: Params }>('/api/documents/:id/file', async (req, reply) => {
    const doc = db.select().from(documents).where(eq(documents.id, req.params.id)).get() ?? notFound('Document');
    reply.type('application/pdf').header('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`);
    return reply.send(createReadStream(doc.path));
  });

  app.get<{ Params: Params }>('/api/documents/:id/pages/:page', async (req, reply) => {
    const page = Number.parseInt(req.params.page, 10);
    const path = pageImagePath(req.params.id, page, 'full');
    if (!Number.isFinite(page) || !existsSync(path)) notFound('Page');
    reply.type('image/png').header('Cache-Control', 'public, max-age=86400');
    return reply.send(createReadStream(path));
  });

  app.get<{ Params: Params }>('/api/documents/:id/sessions-count', async (req) => ({ count: coursesSvc.documentSessionsCount(req.params.id) }));
  app.post<{ Params: Params }>('/api/documents/:id/reanalyze', async (req) => coursesSvc.reanalyzeDocument(req.params.id));
  app.delete<{ Params: Params }>('/api/documents/:id', async (req) => {
    await coursesSvc.deleteDocument(req.params.id);
    return { ok: true };
  });

  // ---------- Jobs ----------

  app.get<{ Params: Params }>('/api/jobs/:id', async (req) => {
    const j = db.select().from(jobs).where(eq(jobs.id, req.params.id)).get() ?? notFound('Tâche');
    return coursesSvc.jobDto(j);
  });
  app.post<{ Params: Params }>('/api/jobs/:id/retry', async (req) => {
    const j = retryJob(req.params.id) ?? notFound('Tâche en erreur');
    return coursesSvc.jobDto(j);
  });

  // ---------- Éditeur ----------

  app.get<{ Params: Params }>('/api/units/:id/editor', async (req) => editor.getEditorUnit(req.params.id));
  app.patch<{ Params: Params; Body: { title?: string; kind?: UnitKind; pageStart?: number | null; pageEnd?: number | null; durationMinutes?: number | null } }>(
    '/api/units/:id',
    async (req) => editor.updateUnit(req.params.id, req.body ?? {}),
  );
  app.delete<{ Params: Params }>('/api/units/:id', async (req) => {
    editor.deleteUnit(req.params.id);
    return { ok: true };
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

  // ---------- Sessions ----------

  app.post<{ Params: Params; Body: { mode?: SessionMode; timeLimitMinutes?: number | null } }>('/api/units/:id/sessions', async (req) => {
    const minutes = req.body?.timeLimitMinutes;
    const s = sessionsSvc.createSession(req.params.id, req.body?.mode ?? 'tp', minutes ? Math.round(minutes * 60) : null);
    return { id: s.id };
  });
  app.get<{ Params: Params }>('/api/sessions/:id', async (req) => sessionsSvc.getSessionState(req.params.id));
  app.delete<{ Params: Params }>('/api/sessions/:id', async (req) => {
    sessionsSvc.deleteSession(req.params.id);
    return { ok: true };
  });
  app.post<{ Params: Params; Body: { questionId: string | null; visible: boolean } }>('/api/sessions/:id/heartbeat', async (req) =>
    sessionsSvc.heartbeat(req.params.id, req.body?.questionId ?? null, Boolean(req.body?.visible)),
  );
  app.post<{ Params: Params; Body: { questionId: string; kind: HelpKind } }>('/api/sessions/:id/help', async (req, reply) => {
    const { questionId, kind } = req.body ?? ({} as { questionId: string; kind: HelpKind });
    if (!['reformulation', 'course_refs', 'hint', 'solution'].includes(kind)) throw new HttpError(400, 'Aide inconnue.');
    await streamSse(reply, (onText) => sessionsSvc.requestHelp(req.params.id, questionId, kind, onText));
  });
  app.post<{ Params: Params; Body: SubmitAttemptBody }>('/api/sessions/:id/attempts', async (req) => sessionsSvc.submitAttempt(req.params.id, req.body));
  app.post<{ Params: Params; Body: { what: 'location' | 'explanation' } }>('/api/sessions/:id/attempts/:attemptId/reveal', async (req) =>
    sessionsSvc.revealError(req.params.id, req.params.attemptId, req.body?.what === 'explanation' ? 'explanation' : 'location'),
  );
  app.post<{ Params: Params; Body: { questionId: string; struggled?: boolean | null } }>('/api/sessions/:id/close-question', async (req) =>
    sessionsSvc.closeQuestion(req.params.id, req.body.questionId, req.body.struggled),
  );
  app.post<{ Params: Params }>('/api/sessions/:id/advance', async (req) => sessionsSvc.advance(req.params.id));
  app.post<{ Params: Params; Body: { questionId: string } }>('/api/sessions/:id/goto', async (req) => sessionsSvc.gotoQuestion(req.params.id, req.body.questionId));
  app.post<{ Params: Params }>('/api/sessions/:id/finish', async (req) => {
    sessionsSvc.finishSession(req.params.id);
    return sessionsSvc.getSessionState(req.params.id);
  });
  app.get<{ Params: Params }>('/api/sessions/:id/report', async (req) => {
    const r = coursesSvc.latestReportForSession(req.params.id) ?? notFound('Bilan');
    return coursesSvc.getReport(r.id);
  });
  app.post<{ Params: Params }>('/api/sessions/:id/report/retry', async (req) => {
    const s = sessionsSvc.loadSession(req.params.id);
    const r = coursesSvc.latestReportForSession(s.id);
    if (r?.status !== 'error') throw new HttpError(409, 'Le bilan n’est pas en erreur.');
    enqueueJob({ type: 'report', courseId: s.courseId, refId: s.id });
    db.update(reports).set({ status: 'pending', error: null }).where(eq(reports.id, r.id)).run();
    return coursesSvc.getReport(r.id);
  });
  app.post<{ Params: Params }>('/api/sessions/:id/review-quiz', async (req) => quiz.createReviewQuiz(req.params.id));
  app.get<{ Params: Params }>('/api/sessions/:id/chat', async (req) => {
    const s = sessionsSvc.loadSession(req.params.id);
    const t = chat.getOrCreateThread('session', s.courseId, s.id);
    return chat.getThread(t.id);
  });

  app.get<{ Params: Params }>('/api/attempts/:id/image', async (req, reply) => {
    const a = db.select({ p: attempts.imagePath }).from(attempts).where(eq(attempts.id, req.params.id)).get();
    if (!a?.p || !existsSync(a.p)) notFound('Image');
    reply.type(a.p.endsWith('.png') ? 'image/png' : 'image/jpeg');
    return reply.send(createReadStream(a.p));
  });

  app.get<{ Params: Params }>('/api/reports/:id', async (req) => coursesSvc.getReport(req.params.id));

  // ---------- Quiz ----------

  app.get<{ Params: Params }>('/api/quizzes/:id', async (req) => quiz.getQuiz(req.params.id));
  app.post<{ Params: Params; Body: { choice?: number | null; text?: string | null } }>('/api/quizzes/:id/items/:itemId/answer', async (req) =>
    quiz.answerItem(req.params.id, req.params.itemId, req.body ?? {}),
  );
  app.post<{ Params: Params }>('/api/quizzes/:id/restart', async (req) => quiz.restartQuiz(req.params.id));
  app.post<{ Params: Params }>('/api/quizzes/:id/retry', async (req) => quiz.retryQuizGeneration(req.params.id));
  app.delete<{ Params: Params }>('/api/quizzes/:id', async (req) => {
    quiz.deleteQuiz(req.params.id);
    return { ok: true };
  });

  // ---------- Points bloquants ----------

  app.patch<{ Params: Params; Body: { status: 'active' | 'mastered' | 'resolved' } }>('/api/weak-points/:id', async (req) => {
    if (!['active', 'mastered', 'resolved'].includes(req.body?.status)) throw new HttpError(400, 'Statut invalide.');
    setWeakPointStatus(req.params.id, req.body.status);
    return { ok: true };
  });
  app.delete<{ Params: Params }>('/api/weak-points/:id', async (req) => {
    db.delete(weakPoints).where(eq(weakPoints.id, req.params.id)).run();
    return { ok: true };
  });

  // ---------- Chat ----------

  app.get<{ Params: Params }>('/api/chat/threads/:id', async (req) => chat.getThread(req.params.id));
  app.post<{ Params: Params; Body: { text: string; imageDataUrl?: string | null } }>('/api/chat/threads/:id/messages', async (req, reply) => {
    await streamSse(reply, (onText) => chat.sendMessage(req.params.id, req.body ?? { text: '' }, onText));
  });
  app.get<{ Params: Params }>('/api/chat/messages/:id/image', async (req, reply) => {
    const p = chat.chatImagePath(req.params.id);
    if (!p || !existsSync(p)) notFound('Image');
    reply.type(p.endsWith('.png') ? 'image/png' : 'image/jpeg');
    return reply.send(createReadStream(p));
  });

  void desc;
}
