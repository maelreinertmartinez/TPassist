// Quiz : création (générée en tâche de fond par jobs/generateQuiz), réponses, correction des questions ouvertes,
// reprise et relance. Chaque réponse sur une question liée à un point bloquant fait évoluer ce point.
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { QuizDto, QuizItemDto, QuizKind, QuizSummary } from '@tpassist/shared';
import { runAgent } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { OpenGradeSchema } from '../ai/schemas';
import { db, newId } from '../db/client';
import { findById } from '../db/repo';
import { courses, quizItems, quizzes, sessionQuestions, sessions, units, weakPoints } from '../db/schema';
import { HttpError, notFound } from '../errors';
import { enqueueJob } from '../jobs/queue';
import { reviewQuizSize } from './struggle';
import { recordOutcome } from './weakPoints';

type ItemRow = typeof quizItems.$inferSelect;

/** Tailles proposées pour le quiz complet. */
const SIZES = { court: 10, moyen: 20, long: 30 } as const;
/** Taille de quiz complet proposée. */
export type CourseQuizSize = keyof typeof SIZES;

/** Question de quiz pour le front : la bonne réponse et l'explication restent cachées tant qu'elle n'est pas répondue. */
function itemDto(it: ItemRow, notions: Map<string, string>): QuizItemDto {
  const answered = it.answeredAt !== null;
  return {
    id: it.id,
    order: it.order,
    type: it.type,
    promptMd: it.promptMd,
    choices: it.choices,
    answered,
    userChoice: it.userChoice,
    userAnswer: it.userAnswer,
    correct: it.correct,
    correctIndex: answered ? it.correctIndex : null,
    expectedAnswerMd: answered ? it.expectedAnswerMd : null,
    explanationMd: answered ? it.explanationMd : null,
    feedbackMd: it.feedbackMd,
    weakPointNotion: it.weakPointId ? (notions.get(it.weakPointId) ?? null) : null,
  };
}

/** Quiz complet avec ses questions. 404 s'il n'existe pas. */
export function getQuiz(id: string): QuizDto {
  const q = findById(quizzes, id, 'Quiz');
  const items = db.select().from(quizItems).where(eq(quizItems.quizId, id)).orderBy(asc(quizItems.order)).all();
  const wpIds = [...new Set(items.map((i) => i.weakPointId).filter((x): x is string => Boolean(x)))];
  const notions = new Map(
    wpIds.length ? db.select({ id: weakPoints.id, notion: weakPoints.notion }).from(weakPoints).where(inArray(weakPoints.id, wpIds)).all().map((w) => [w.id, w.notion]) : [],
  );
  return {
    id: q.id,
    courseId: q.courseId,
    courseName: findById(courses, q.courseId, 'Cours').name,
    kind: q.kind,
    title: q.title,
    status: q.status,
    error: q.error,
    score: q.score,
    total: q.total,
    items: items.map((i) => itemDto(i, notions)),
    createdAt: q.createdAt,
  };
}

/** Quiz d'un cours pour l'historique, du plus récent au plus ancien. */
export function listQuizzes(courseId: string): QuizSummary[] {
  return db
    .select()
    .from(quizzes)
    .where(eq(quizzes.courseId, courseId))
    .orderBy(desc(quizzes.createdAt))
    .all()
    .map((q) => ({ id: q.id, kind: q.kind, title: q.title, status: q.status, score: q.score, total: q.total, createdAt: q.createdAt }));
}

/** Crée un quiz vide et lance sa génération. */
function createQuiz(courseId: string, kind: QuizKind, title: string, size: number, sessionId: string | null) {
  const id = newId();
  db.insert(quizzes).values({ id, courseId, kind, title, sessionId, status: 'generating', total: size }).run();
  enqueueJob({ type: 'quiz', courseId, refId: id, payload: { size } });
  return getQuiz(id);
}

/** Quiz complet sur tout le cours (10, 20 ou 30 questions). */
export function createCourseQuiz(courseId: string, size: CourseQuizSize) {
  const n = SIZES[size] ?? SIZES.court;
  return createQuiz(courseId, 'course_full', `Quiz complet (${n} questions)`, n, null);
}

/** Quiz de révision facultatif d'une session (créé une seule fois, à la demande). */
export function createReviewQuiz(sessionId: string) {
  const s = findById(sessions, sessionId, 'Session');
  if (s.reviewQuizId) {
    const existing = db.select().from(quizzes).where(eq(quizzes.id, s.reviewQuizId)).get();
    if (existing && existing.status !== 'error') return getQuiz(existing.id);
  }
  const unit = findById(units, s.unitId, 'Partie');
  const flags = db.select({ flags: sessionQuestions.flags }).from(sessionQuestions).where(eq(sessionQuestions.sessionId, sessionId)).all();
  const { size } = reviewQuizSize(flags.map((f) => f.flags));
  const quiz = createQuiz(s.courseId, 'tp_review', `Révision — ${unit.title}`, size, sessionId);
  db.update(sessions).set({ reviewQuizId: quiz.id }).where(eq(sessions.id, sessionId)).run();
  return quiz;
}

/**
 * Enregistre la réponse à une question (une seule fois) ; une question ouverte est corrigée par l'IA.
 * Le quiz passe à « terminé » quand toutes les questions ont une réponse.
 * @throws HttpError 409 si le quiz n'est pas jouable, 400 si la réponse est vide
 */
export async function answerItem(quizId: string, itemId: string, body: { choice?: number | null; text?: string | null }) {
  const quiz = findById(quizzes, quizId, 'Quiz');
  if (quiz.status !== 'ready') throw new HttpError(409, "Ce quiz n'est pas jouable pour l'instant.");
  const it = findById(quizItems, itemId, 'Question de quiz');
  if (it.quizId !== quizId) notFound('Question de quiz');
  if (it.answeredAt !== null) return getQuiz(quizId);

  let correct: boolean;
  let feedbackMd: string | null = null;
  if (it.type === 'mcq') {
    if (body.choice === undefined || body.choice === null) throw new HttpError(400, 'Choisis une réponse.');
    correct = body.choice === it.correctIndex;
  } else {
    const text = body.text?.trim();
    if (!text) throw new HttpError(400, 'Ta réponse est vide.');
    const r = await runAgent({
      task: 'quiz.grade_open',
      kind: 'tutor',
      system: PROMPTS.gradeOpen,
      content: `Question :\n${it.promptMd}\n\nRéponse attendue :\n${it.expectedAnswerMd ?? it.explanationMd}\n\nRéponse de l'étudiant :\n${text}`,
      schema: OpenGradeSchema,
      effort: 'low',
      mock: () => {
        const ok = text.length > 3 && !text.toLowerCase().includes('faux');
        return { correct: ok, feedbackMd: ok ? 'Bonne réponse (simulation).' : 'Réponse incomplète (simulation).' };
      },
    });
    correct = r.data.correct;
    feedbackMd = r.data.feedbackMd;
  }
  db.update(quizItems)
    .set({ userChoice: body.choice ?? null, userAnswer: body.text ?? null, correct, feedbackMd, answeredAt: Date.now() })
    .where(eq(quizItems.id, itemId))
    .run();
  if (it.weakPointId) recordOutcome(it.weakPointId, correct ? 'success' : 'failure', 'quiz', quiz.title);

  const items = db.select({ answeredAt: quizItems.answeredAt, correct: quizItems.correct }).from(quizItems).where(eq(quizItems.quizId, quizId)).all();
  if (items.every((i) => i.answeredAt !== null)) {
    db.update(quizzes)
      .set({ status: 'done', score: items.filter((i) => i.correct).length, finishedAt: Date.now() })
      .where(eq(quizzes.id, quizId))
      .run();
  }
  return getQuiz(quizId);
}

/** Efface les réponses pour refaire le quiz. */
export function restartQuiz(quizId: string) {
  const quiz = findById(quizzes, quizId, 'Quiz');
  if (quiz.status !== 'done' && quiz.status !== 'ready') throw new HttpError(409, "Ce quiz n'est pas encore prêt.");
  db.update(quizItems)
    .set({ userChoice: null, userAnswer: null, correct: null, feedbackMd: null, answeredAt: null })
    .where(eq(quizItems.quizId, quizId))
    .run();
  db.update(quizzes).set({ status: 'ready', score: null, finishedAt: null }).where(eq(quizzes.id, quizId)).run();
  return getQuiz(quizId);
}

/** Relance la génération d'un quiz en erreur. */
export function retryQuizGeneration(quizId: string) {
  const quiz = findById(quizzes, quizId, 'Quiz');
  if (quiz.status !== 'error') return getQuiz(quizId);
  db.delete(quizItems).where(eq(quizItems.quizId, quizId)).run();
  db.update(quizzes).set({ status: 'generating', error: null }).where(eq(quizzes.id, quizId)).run();
  enqueueJob({ type: 'quiz', courseId: quiz.courseId, refId: quizId, payload: { size: quiz.total || 10 } });
  return getQuiz(quizId);
}

