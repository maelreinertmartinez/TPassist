import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { rm, writeFile, mkdir } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { CourseDetail, CourseSummary, DocumentDto, JobDto, ReportDto, SectionDto, UnitDto } from '@tpassist/shared';
import { config } from '../config';
import { db, newId } from '../db/client';
import { deleteUnits, HttpError, notFound } from '../db/repo';
import { attempts, chatMessages, chatThreads, courseSections, courses, documents, jobs, notions, questions, reports, sessionQuestions, sessions, units, weakPoints } from '../db/schema';
import { enqueueJob } from '../jobs/queue';
import { listQuizzes } from './quiz';
import { listSessions } from './sessions';
import { reviewQuizSize } from './struggle';
import { listWeakPoints } from './weakPoints';

const PALETTE = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#2563eb'];

export function listCourses(): CourseSummary[] {
  const rows = db.select().from(courses).orderBy(asc(courses.createdAt)).all();
  return rows.map((c) => {
    const us = db.select({ kind: units.kind }).from(units).where(eq(units.courseId, c.id)).all();
    const count = (k: string) => us.filter((u) => u.kind === k).length;
    const inProgress = db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.courseId, c.id), eq(sessions.status, 'in_progress')))
      .all().length;
    const wps = db
      .select({ id: weakPoints.id })
      .from(weakPoints)
      .where(and(eq(weakPoints.courseId, c.id), eq(weakPoints.status, 'active')))
      .all().length;
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      icon: c.icon,
      createdAt: c.createdAt,
      counts: { cours: count('cours'), td: count('td'), tp: count('tp'), ei: count('ei') },
      inProgressSessions: inProgress,
      activeWeakPoints: wps,
    };
  });
}

/** Clé d'icône : identifiant court (le jeu d'icônes est défini côté front). */
function checkIcon(icon: string): string {
  if (!/^[a-z0-9-]{1,40}$/.test(icon)) throw new HttpError(400, 'Icône invalide.');
  return icon;
}

export function createCourse(name: string, color?: string, icon?: string) {
  const n = name.trim();
  if (!n) throw new HttpError(400, 'Le nom du cours est obligatoire.');
  const count = db.select({ id: courses.id }).from(courses).all().length;
  return db
    .insert(courses)
    .values({ id: newId(), name: n, color: color || PALETTE[count % PALETTE.length], ...(icon ? { icon: checkIcon(icon) } : {}) })
    .returning()
    .get();
}

export function updateCourse(id: string, patch: { name?: string; color?: string; icon?: string }) {
  const set: Partial<typeof courses.$inferInsert> = { updatedAt: Date.now() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new HttpError(400, 'Le nom du cours est obligatoire.');
    set.name = patch.name.trim();
  }
  if (patch.color) set.color = patch.color;
  if (patch.icon) set.icon = checkIcon(patch.icon);
  const row = db.update(courses).set(set).where(eq(courses.id, id)).returning().get();
  return row ?? notFound('Cours');
}

/** Supprime un cours, tout ce qui en dépend en base et ses fichiers (PDF, pages rendues, photos de réponses et du chat). */
export async function deleteCourse(id: string) {
  db.select({ id: courses.id }).from(courses).where(eq(courses.id, id)).get() ?? notFound('Cours');
  const unitIds = db.select({ id: units.id }).from(units).where(eq(units.courseId, id)).all().map((u) => u.id);
  const docIds = db.select({ id: documents.id }).from(documents).where(eq(documents.courseId, id)).all().map((d) => d.id);
  const sessionIds = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.courseId, id)).all().map((s) => s.id);
  const photos = [
    ...(sessionIds.length ? db.select({ path: attempts.imagePath }).from(attempts).where(inArray(attempts.sessionId, sessionIds)).all() : []),
    ...db
      .select({ path: chatMessages.imagePath })
      .from(chatMessages)
      .innerJoin(chatThreads, eq(chatThreads.id, chatMessages.threadId))
      .where(eq(chatThreads.courseId, id))
      .all(),
  ]
    .map((r) => r.path)
    .filter((p): p is string => Boolean(p));
  deleteUnits(unitIds);
  db.delete(courses).where(eq(courses.id, id)).run();
  // Les tâches pas encore lancées n'ont plus d'objet (une tâche déjà en cours échouera sans conséquence).
  db.delete(jobs).where(and(eq(jobs.courseId, id), eq(jobs.status, 'queued'))).run();
  await rm(join(config.filesDir, id), { recursive: true, force: true });
  for (const d of docIds) await rm(join(config.pagesDir, d), { recursive: true, force: true });
  for (const p of photos) {
    // Par prudence, on ne supprime que dans le dossier des photos.
    const inside = relative(config.answersDir, p);
    if (inside && !inside.startsWith('..') && !isAbsolute(inside)) await rm(p, { force: true });
  }
}

export function documentDto(d: typeof documents.$inferSelect): DocumentDto {
  return { id: d.id, filename: d.filename, pageCount: d.pageCount, status: d.status, error: d.error, createdAt: d.createdAt };
}

export function unitDtos(courseId: string): UnitDto[] {
  const rows = db.select().from(units).where(eq(units.courseId, courseId)).orderBy(asc(units.order)).all();
  const docs = new Map(
    db
      .select({ id: documents.id, filename: documents.filename })
      .from(documents)
      .where(eq(documents.courseId, courseId))
      .all()
      .map((d) => [d.id, d.filename]),
  );
  const ids = rows.map((r) => r.id);
  const qCounts = new Map<string, number>();
  const sCounts = new Map<string, number>();
  if (ids.length) {
    for (const q of db.select({ unitId: questions.unitId }).from(questions).where(inArray(questions.unitId, ids)).all()) {
      qCounts.set(q.unitId, (qCounts.get(q.unitId) ?? 0) + 1);
    }
    for (const s of db.select({ unitId: courseSections.unitId }).from(courseSections).where(inArray(courseSections.unitId, ids)).all()) {
      sCounts.set(s.unitId, (sCounts.get(s.unitId) ?? 0) + 1);
    }
  }
  const corrected = new Set(rows.filter((r) => r.kind === 'corrige' && r.correctsUnitId).map((r) => r.correctsUnitId!));
  const withInline = new Set(
    ids.length
      ? db
          .select({ unitId: questions.unitId, sol: questions.officialSolutionMd })
          .from(questions)
          .where(inArray(questions.unitId, ids))
          .all()
          .filter((q) => q.sol)
          .map((q) => q.unitId)
      : [],
  );
  return rows.map((u) => ({
    id: u.id,
    courseId: u.courseId,
    kind: u.kind,
    title: u.title,
    order: u.order,
    documentId: u.documentId,
    documentName: u.documentId ? (docs.get(u.documentId) ?? null) : null,
    pageStart: u.pageStart,
    pageEnd: u.pageEnd,
    origin: u.origin,
    correctsUnitId: u.correctsUnitId,
    hasCorrection: corrected.has(u.id) || withInline.has(u.id),
    questionCount: qCounts.get(u.id) ?? 0,
    sectionCount: sCounts.get(u.id) ?? 0,
    meta: u.kind === 'corrige' ? { targetTitle: u.meta.targetTitle, solutions: u.meta.solutions } : { durationMinutes: u.meta.durationMinutes ?? null, generation: u.meta.generation },
  }));
}

export function sectionDtos(courseId: string): SectionDto[] {
  return db
    .select()
    .from(courseSections)
    .where(eq(courseSections.courseId, courseId))
    .orderBy(asc(courseSections.order))
    .all()
    .map((s) => ({ id: s.id, unitId: s.unitId, title: s.title, pageStart: s.pageStart, pageEnd: s.pageEnd, summary: s.summary, keyConcepts: s.keyConcepts }));
}

export function jobDto(j: typeof jobs.$inferSelect): JobDto {
  return { id: j.id, type: j.type, status: j.status, progress: j.progress, message: j.message, error: j.error, refId: j.refId, createdAt: j.createdAt, updatedAt: j.updatedAt };
}

export function recentJobs(courseId: string): JobDto[] {
  const cutoff = Date.now() - 10 * 60 * 1000;
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.courseId, courseId))
    .orderBy(desc(jobs.createdAt))
    .limit(30)
    .all()
    .filter((j) => j.status === 'queued' || j.status === 'running' || j.updatedAt > cutoff || j.status === 'error')
    .map(jobDto);
}

export function getCourseDetail(id: string): CourseDetail {
  const c = db.select().from(courses).where(eq(courses.id, id)).get() ?? notFound('Cours');
  return {
    course: { id: c.id, name: c.name, color: c.color, icon: c.icon, createdAt: c.createdAt },
    documents: db.select().from(documents).where(eq(documents.courseId, id)).orderBy(asc(documents.createdAt)).all().map(documentDto),
    units: unitDtos(id),
    sections: sectionDtos(id),
    jobs: recentJobs(id),
    sessions: listSessions(id),
    quizzes: listQuizzes(id),
    weakPoints: listWeakPoints(id),
    notionCount: db.select({ id: notions.id }).from(notions).where(eq(notions.courseId, id)).all().length,
  };
}

// ---------- Documents ----------

export async function addDocument(courseId: string, filename: string, data: Buffer) {
  db.select({ id: courses.id }).from(courses).where(eq(courses.id, courseId)).get() ?? notFound('Cours');
  if (data.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(400, `« ${filename} » n'est pas un PDF valide.`);
  const id = newId();
  const dir = join(config.filesDir, courseId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.pdf`);
  await writeFile(path, data);
  const doc = db.insert(documents).values({ id, courseId, filename, path, status: 'pending' }).returning().get();
  const job = enqueueJob({ type: 'ingest', courseId, refId: id });
  return { document: documentDto(doc), job: jobDto(job) };
}

export function reanalyzeDocument(id: string) {
  const doc = db.select().from(documents).where(eq(documents.id, id)).get() ?? notFound('Document');
  db.update(documents).set({ status: 'pending', error: null }).where(eq(documents.id, id)).run();
  return jobDto(enqueueJob({ type: 'ingest', courseId: doc.courseId, refId: id }));
}

export async function deleteDocument(id: string) {
  const doc = db.select().from(documents).where(eq(documents.id, id)).get() ?? notFound('Document');
  const unitIds = db.select({ id: units.id }).from(units).where(eq(units.documentId, id)).all().map((u) => u.id);
  deleteUnits(unitIds);
  db.delete(documents).where(eq(documents.id, id)).run();
  await rm(doc.path, { force: true });
  await rm(join(config.pagesDir, id), { recursive: true, force: true });
}

export function documentSessionsCount(id: string): number {
  const unitIds = db.select({ id: units.id }).from(units).where(eq(units.documentId, id)).all().map((u) => u.id);
  if (!unitIds.length) return 0;
  return db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.unitId, unitIds)).all().length;
}

// ---------- Bilans ----------

export function getReport(reportId: string): ReportDto {
  const r = db.select().from(reports).where(eq(reports.id, reportId)).get() ?? notFound('Bilan');
  const s = db.select().from(sessions).where(eq(sessions.id, r.sessionId)).get() ?? notFound('Session');
  const unit = db.select().from(units).where(eq(units.id, s.unitId)).get() ?? notFound('Partie');
  const flags = db.select({ flags: sessionQuestions.flags }).from(sessionQuestions).where(eq(sessionQuestions.sessionId, s.id)).all();
  const { size, noStruggle } = reviewQuizSize(flags.map((f) => f.flags));
  return {
    id: r.id,
    sessionId: s.id,
    status: r.status,
    error: r.error,
    courseId: s.courseId,
    unitTitle: unit.title,
    unitKind: unit.kind,
    mode: s.mode,
    score: r.score,
    createdAt: r.createdAt,
    strengthsMd: r.content?.strengthsMd ?? '',
    overallMd: r.content?.overallMd ?? '',
    blockingPoints: r.content?.blockingPoints ?? [],
    questions: r.content?.questions ?? [],
    reviewQuiz: { proposedSize: size, noStruggle, quizId: s.reviewQuizId },
  };
}

export function latestReportForSession(sessionId: string) {
  return db.select().from(reports).where(eq(reports.sessionId, sessionId)).orderBy(desc(reports.createdAt)).get();
}
