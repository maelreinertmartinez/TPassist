// Cours : tableau de bord, création, modification, suppression et page de détail.
import { and, asc, desc, eq, gt, inArray, or } from 'drizzle-orm';
import { COURSE_COLORS, type CourseDetail, type CourseSummary, type SectionDto, type UnitDto } from '@tpassist/shared';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config';
import { db, newId } from '../db/client';
import { countWhere, courseUnits, deleteUnits, findById } from '../db/repo';
import { attempts, chatMessages, chatThreads, courseSections, courses, documents, jobs, notions, questions, sessions } from '../db/schema';
import { HttpError } from '../errors';
import { jobDto } from '../jobs/queue';
import { listDocuments, removeDocumentFiles } from './documents';
import { removeImages } from './images';
import { listQuizzes } from './quiz';
import { listSessions } from './sessions';
import { activeWeakPoints, listWeakPoints } from './weakPoints';

/** Les tâches terminées restent visibles 10 minutes sur la page du cours. */
const RECENT_JOB_MS = 10 * 60 * 1000;

/** Tuiles du tableau de bord, dans l'ordre de création. */
export function listCourses(): CourseSummary[] {
  return db
    .select()
    .from(courses)
    .orderBy(asc(courses.createdAt))
    .all()
    .map((c) => {
      const kinds = courseUnits(c.id).map((u) => u.kind);
      const count = (k: string) => kinds.filter((kind) => kind === k).length;
      return {
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
        createdAt: c.createdAt,
        counts: { cours: count('cours'), td: count('td'), tp: count('tp'), ei: count('ei') },
        inProgressSessions: countWhere(sessions, and(eq(sessions.courseId, c.id), eq(sessions.status, 'in_progress'))),
        activeWeakPoints: activeWeakPoints(c.id).length,
      };
    });
}

function checkName(name: string): string {
  const n = name.trim();
  if (!n) throw new HttpError(400, 'Le nom du cours est obligatoire.');
  return n;
}

/** Clé d'icône : identifiant court (le jeu d'icônes est défini côté front). */
function checkIcon(icon: string): string {
  if (!/^[a-z0-9-]{1,40}$/.test(icon)) throw new HttpError(400, 'Icône invalide.');
  return icon;
}

/** Crée un cours ; sans couleur choisie, les couleurs de la palette sont prises à tour de rôle. */
export function createCourse(name: string, color?: string, icon?: string) {
  return db
    .insert(courses)
    .values({
      id: newId(),
      name: checkName(name),
      color: color || COURSE_COLORS[countWhere(courses) % COURSE_COLORS.length],
      ...(icon ? { icon: checkIcon(icon) } : {}),
    })
    .returning()
    .get();
}

/** Renomme un cours ou change sa couleur ou son icône. 404 si le cours n'existe pas. */
export function updateCourse(id: string, patch: { name?: string; color?: string; icon?: string }) {
  const set: Partial<typeof courses.$inferInsert> = { updatedAt: Date.now() };
  if (patch.name !== undefined) set.name = checkName(patch.name);
  if (patch.color) set.color = patch.color;
  if (patch.icon) set.icon = checkIcon(patch.icon);
  return db.update(courses).set(set).where(eq(courses.id, id)).returning().get() ?? findById(courses, id, 'Cours');
}

/** Supprime un cours, tout ce qui en dépend en base et ses fichiers (PDF, pages rendues, photos de réponses et du chat). */
export async function deleteCourse(id: string) {
  findById(courses, id, 'Cours');
  const docs = db.select({ id: documents.id, path: documents.path }).from(documents).where(eq(documents.courseId, id)).all();
  const photos = coursePhotos(id);
  deleteUnits(courseUnits(id).map((u) => u.id));
  db.delete(courses).where(eq(courses.id, id)).run();
  // Les tâches pas encore lancées n'ont plus d'objet (une tâche déjà en cours échouera sans conséquence).
  db.delete(jobs).where(and(eq(jobs.courseId, id), eq(jobs.status, 'queued'))).run();
  for (const d of docs) await removeDocumentFiles(d);
  await rm(join(config.filesDir, id), { recursive: true, force: true });
  await removeImages(photos);
}

/** Photos de copies et images du chat d'un cours. */
function coursePhotos(courseId: string): string[] {
  const sessionIds = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.courseId, courseId)).all().map((s) => s.id);
  const rows = [
    ...(sessionIds.length ? db.select({ path: attempts.imagePath }).from(attempts).where(inArray(attempts.sessionId, sessionIds)).all() : []),
    ...db
      .select({ path: chatMessages.imagePath })
      .from(chatMessages)
      .innerJoin(chatThreads, eq(chatThreads.id, chatMessages.threadId))
      .where(eq(chatThreads.courseId, courseId))
      .all(),
  ];
  return rows.map((r) => r.path).filter((p): p is string => Boolean(p));
}

/** Unités d'un cours pour le front, avec leurs compteurs et le nom de leur document. */
export function unitDtos(courseId: string): UnitDto[] {
  const rows = courseUnits(courseId);
  const docNames = new Map(
    db.select({ id: documents.id, filename: documents.filename }).from(documents).where(eq(documents.courseId, courseId)).all().map((d) => [d.id, d.filename]),
  );
  const ids = rows.map((r) => r.id);
  const qs = ids.length
    ? db.select({ unitId: questions.unitId, solution: questions.officialSolutionMd }).from(questions).where(inArray(questions.unitId, ids)).all()
    : [];
  const secs = ids.length ? db.select({ unitId: courseSections.unitId }).from(courseSections).where(inArray(courseSections.unitId, ids)).all() : [];
  const tally = (list: { unitId: string }[], id: string) => list.filter((x) => x.unitId === id).length;
  // Une unité est corrigée si un corrigé y est rattaché ou si ses questions ont une solution intégrée au sujet.
  const corrected = new Set([
    ...rows.filter((r) => r.kind === 'corrige' && r.correctsUnitId).map((r) => r.correctsUnitId!),
    ...qs.filter((q) => q.solution).map((q) => q.unitId),
  ]);
  return rows.map((u) => ({
    id: u.id,
    courseId: u.courseId,
    kind: u.kind,
    title: u.title,
    order: u.order,
    documentId: u.documentId,
    documentName: u.documentId ? (docNames.get(u.documentId) ?? null) : null,
    pageStart: u.pageStart,
    pageEnd: u.pageEnd,
    origin: u.origin,
    correctsUnitId: u.correctsUnitId,
    hasCorrection: corrected.has(u.id),
    questionCount: tally(qs, u.id),
    sectionCount: tally(secs, u.id),
    meta: u.kind === 'corrige' ? { targetTitle: u.meta.targetTitle, solutions: u.meta.solutions } : { durationMinutes: u.meta.durationMinutes ?? null, generation: u.meta.generation },
  }));
}

/** Section de cours pour le front (sans son contenu complet). */
export function sectionDto(s: typeof courseSections.$inferSelect): SectionDto {
  return { id: s.id, unitId: s.unitId, title: s.title, pageStart: s.pageStart, pageEnd: s.pageEnd, summary: s.summary, keyConcepts: s.keyConcepts };
}

/** Tâches en attente, en cours, en erreur ou terminées depuis peu (les plus récentes d'abord). */
function recentJobs(courseId: string) {
  const since = Date.now() - RECENT_JOB_MS;
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.courseId, courseId), or(inArray(jobs.status, ['queued', 'running', 'error']), gt(jobs.updatedAt, since))))
    .orderBy(desc(jobs.createdAt))
    .limit(30)
    .all()
    .map(jobDto);
}

/** Tout ce qu'affiche la page d'un cours. 404 si le cours n'existe pas. */
export function getCourseDetail(id: string): CourseDetail {
  const c = findById(courses, id, 'Cours');
  return {
    course: { id: c.id, name: c.name, color: c.color, icon: c.icon, createdAt: c.createdAt },
    documents: listDocuments(id),
    units: unitDtos(id),
    sections: db.select().from(courseSections).where(eq(courseSections.courseId, id)).orderBy(asc(courseSections.order)).all().map(sectionDto),
    jobs: recentJobs(id),
    sessions: listSessions(id),
    quizzes: listQuizzes(id),
    weakPoints: listWeakPoints(id),
    notionCount: countWhere(notions, eq(notions.courseId, id)),
  };
}
