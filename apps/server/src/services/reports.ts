// Bilans de fin de séance : lecture et relance. La rédaction elle-même est une tâche de fond (jobs/generateReport).
import { desc, eq } from 'drizzle-orm';
import type { ReportDto } from '@tpassist/shared';
import { db } from '../db/client';
import { findById } from '../db/repo';
import { courses, reports, sessionQuestions, sessions, units } from '../db/schema';
import { HttpError } from '../errors';
import { enqueueJob } from '../jobs/queue';
import { reviewQuizSize } from './struggle';

/** Bilan le plus récent d'une séance (une séance relancée peut en avoir plusieurs). */
export function latestReport(sessionId: string) {
  return db.select().from(reports).where(eq(reports.sessionId, sessionId)).orderBy(desc(reports.createdAt)).get();
}

/** Bilan complet, avec la proposition de quiz de révision. 404 si le bilan n'existe pas. */
export function getReport(reportId: string): ReportDto {
  const r = findById(reports, reportId, 'Bilan');
  const s = findById(sessions, r.sessionId, 'Session');
  const unit = findById(units, s.unitId, 'Partie');
  const course = findById(courses, s.courseId, 'Cours');
  const flags = db.select({ flags: sessionQuestions.flags }).from(sessionQuestions).where(eq(sessionQuestions.sessionId, s.id)).all();
  const { size, noStruggle } = reviewQuizSize(flags.map((f) => f.flags));
  return {
    id: r.id,
    sessionId: s.id,
    status: r.status,
    error: r.error,
    courseId: s.courseId,
    courseName: course.name,
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

/**
 * Relance la rédaction d'un bilan en erreur.
 * @throws HttpError 409 si le dernier bilan de la séance n'est pas en erreur
 */
export function retryReport(sessionId: string): ReportDto {
  const s = findById(sessions, sessionId, 'Session');
  const r = latestReport(s.id);
  if (r?.status !== 'error') throw new HttpError(409, 'Le bilan n’est pas en erreur.');
  enqueueJob({ type: 'report', courseId: s.courseId, refId: s.id });
  db.update(reports).set({ status: 'pending', error: null }).where(eq(reports.id, r.id)).run();
  return getReport(r.id);
}
