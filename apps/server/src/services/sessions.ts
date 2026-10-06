import { and, asc, desc, eq } from 'drizzle-orm';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  EMPTY_FLAGS,
  type AttemptDto,
  type HeartbeatResponse,
  type HelpEventDto,
  type HelpKind,
  type QuestionView,
  type SessionMode,
  type SessionState,
  type SessionSummary,
  type SubmitAttemptBody,
  type SubmitAttemptResponse,
} from '@tpassist/shared';
import { config } from '../config';
import { db, newId } from '../db/client';
import { HttpError, notFound, orderedQuestions, questionWithContext, type QuestionContext } from '../db/repo';
import { attempts, chatThreads, courses, reports, sessionEvents, sessionQuestions, sessions, units } from '../db/schema';
import { enqueueJob, hasPendingJob } from '../jobs/queue';
import { pageImageUrl } from '../pdf/render';
import { computeLocks, heartbeatDelta } from './unlocks';
import * as tutor from './tutor';

type SessionRow = typeof sessions.$inferSelect;
type SqRow = typeof sessionQuestions.$inferSelect;
type AttemptRow = typeof attempts.$inferSelect;
type EventRow = typeof sessionEvents.$inferSelect;

const DEFAULT_EI_SECONDS = 2 * 3600;

// ---------- Chargement ----------

export function loadSession(id: string): SessionRow {
  return db.select().from(sessions).where(eq(sessions.id, id)).get() ?? notFound('Session');
}

function loadSq(sessionId: string, questionId: string): SqRow {
  return (
    db
      .select()
      .from(sessionQuestions)
      .where(and(eq(sessionQuestions.sessionId, sessionId), eq(sessionQuestions.questionId, questionId)))
      .get() ?? notFound('Question de session')
  );
}

function updateSq(sessionId: string, questionId: string, patch: Partial<SqRow>) {
  db.update(sessionQuestions)
    .set(patch)
    .where(and(eq(sessionQuestions.sessionId, sessionId), eq(sessionQuestions.questionId, questionId)))
    .run();
}

function touchSession(id: string, patch: Partial<SessionRow> = {}) {
  db.update(sessions)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(sessions.id, id))
    .run();
}

function attemptsFor(sessionId: string, questionId: string): AttemptRow[] {
  return db
    .select()
    .from(attempts)
    .where(and(eq(attempts.sessionId, sessionId), eq(attempts.questionId, questionId)))
    .orderBy(asc(attempts.createdAt))
    .all();
}

function eventsFor(sessionId: string, questionId: string): EventRow[] {
  return db
    .select()
    .from(sessionEvents)
    .where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.questionId, questionId)))
    .orderBy(asc(sessionEvents.createdAt))
    .all();
}

function requireActive(s: SessionRow) {
  if (s.status !== 'in_progress') throw new HttpError(409, 'Cette session est terminée.');
}

function requireHelpsAllowed(s: SessionRow) {
  if (s.mode === 'ei_examen') throw new HttpError(403, 'Les aides sont désactivées en mode examen.');
}

function requireCurrent(s: SessionRow, questionId: string) {
  if (s.currentQuestionId !== questionId) throw new HttpError(409, "Cette question n'est plus la question en cours. Recharge la page.");
}

// ---------- DTO ----------

export function attemptDto(a: AttemptRow): AttemptDto {
  return {
    id: a.id,
    type: a.type,
    text: a.answerText,
    code: a.code,
    codeLang: a.codeLang,
    imageUrl: a.imagePath ? `/api/attempts/${a.id}/image` : null,
    verdict: a.verdict,
    revealed: {
      location: a.revealed.includes('location') ? (a.hidden?.errorLocation ?? '') : undefined,
      explanation: a.revealed.includes('explanation') ? (a.hidden?.errorExplanation ?? '') : undefined,
    },
    createdAt: a.createdAt,
  };
}

function eventDto(e: EventRow): HelpEventDto {
  return {
    id: e.id,
    kind: e.kind,
    contentMd: e.contentMd,
    courseRefs: e.data?.courseRefs,
    solutionSource: e.data?.source,
    attemptId: e.attemptId,
    createdAt: e.createdAt,
  };
}

export function questionView(ctx: QuestionContext): QuestionView {
  const { q, ex } = ctx;
  return {
    id: q.id,
    label: q.label,
    exerciseTitle: ex.title,
    contextMd: ex.contextMd,
    statementMd: q.statementMd,
    figures: q.documentId ? q.figurePages.map((page) => ({ page, url: pageImageUrl(q.documentId!, page) })) : [],
    dependsOnPrevious: q.dependsOnPrevious,
    points: q.points,
    hasOfficialSolution: Boolean(q.officialSolutionMd),
  };
}

function locksFor(s: SessionRow, sq: SqRow, list: AttemptRow[]) {
  return computeLocks({
    mode: s.mode,
    activeMs: sq.activeMs,
    delayMs: config.unlockDelayMs,
    closed: sq.closed,
    courseRefsAtMs: sq.courseRefsAtMs,
    hintAtMs: sq.hintAtMs,
    solutionUnlocked: sq.solutionUnlocked,
    attempts: list,
  });
}

// ---------- Création / état ----------

export function createSession(unitId: string, mode: SessionMode, timeLimitSec?: number | null): SessionRow {
  const unit = db.select().from(units).where(eq(units.id, unitId)).get() ?? notFound('Partie');
  if (!['td', 'tp', 'ei'].includes(unit.kind)) throw new HttpError(400, 'Seuls les TD, TP et EI peuvent être lancés.');
  if (unit.kind === 'ei' && mode === 'tp') mode = 'ei_aides';
  if (unit.kind !== 'ei' && mode !== 'tp') mode = 'tp';
  const qs = orderedQuestions(unitId);
  if (qs.length === 0) throw new HttpError(400, "Aucune question n'a été détectée dans cette partie. Corrige-la dans l'éditeur.");

  const isEi = unit.kind === 'ei';
  const limit = isEi ? (timeLimitSec ?? (unit.meta.durationMinutes ? unit.meta.durationMinutes * 60 : DEFAULT_EI_SECONDS)) : null;
  const id = newId();
  const row = db
    .insert(sessions)
    .values({
      id,
      courseId: unit.courseId,
      unitId,
      mode,
      status: 'in_progress',
      currentQuestionId: qs[0].q.id,
      timeLimitSec: limit,
    })
    .returning()
    .get();
  qs.forEach(({ q }, i) => {
    db.insert(sessionQuestions)
      .values({ sessionId: id, questionId: q.id, order: i, status: i === 0 ? 'seen' : 'unseen', flags: { ...EMPTY_FLAGS } })
      .run();
  });
  return row;
}

export function getSessionState(id: string): SessionState {
  const s = loadSession(id);
  const unit = db.select().from(units).where(eq(units.id, s.unitId)).get() ?? notFound('Partie');
  const course = db.select().from(courses).where(eq(courses.id, s.courseId)).get() ?? notFound('Cours');
  const sqs = db.select().from(sessionQuestions).where(eq(sessionQuestions.sessionId, id)).orderBy(asc(sessionQuestions.order)).all();
  const qs = orderedQuestions(s.unitId);
  const byQ = new Map(qs.map((r) => [r.q.id, r]));
  const answered = new Set(
    db
      .select({ q: attempts.questionId })
      .from(attempts)
      .where(eq(attempts.sessionId, id))
      .all()
      .map((r) => r.q),
  );
  const report = db.select({ id: reports.id }).from(reports).where(eq(reports.sessionId, id)).orderBy(desc(reports.createdAt)).get();
  const thread = db.select({ id: chatThreads.id }).from(chatThreads).where(eq(chatThreads.sessionId, id)).get();

  let current: SessionState['current'] = null;
  if (s.currentQuestionId && s.status === 'in_progress') {
    const sq = sqs.find((x) => x.questionId === s.currentQuestionId);
    if (sq) {
      const list = attemptsFor(id, sq.questionId);
      current = {
        question: questionView(questionWithContext(sq.questionId)),
        status: sq.status,
        closed: sq.closed,
        flags: sq.flags,
        events: eventsFor(id, sq.questionId).map(eventDto),
        attempts: list.map(attemptDto),
        locks: locksFor(s, sq, list),
      };
    }
  }

  return {
    session: {
      id: s.id,
      courseId: s.courseId,
      courseName: course.name,
      unitId: s.unitId,
      unitTitle: unit.title,
      unitKind: unit.kind,
      mode: s.mode,
      status: s.status,
      timeLimitSec: s.timeLimitSec,
      elapsedSec: Math.floor(s.elapsedSec),
      score: s.score,
      reportId: report?.id ?? null,
      reviewQuizId: s.reviewQuizId,
      chatThreadId: thread?.id ?? null,
    },
    outline: sqs
      .filter((sq) => byQ.has(sq.questionId))
      .map((sq) => ({
        id: sq.questionId,
        label: byQ.get(sq.questionId)!.q.label,
        exerciseTitle: byQ.get(sq.questionId)!.ex.title,
        status: sq.status,
        answered: answered.has(sq.questionId),
      })),
    currentQuestionId: s.currentQuestionId,
    current,
  };
}

export function listSessions(courseId: string): SessionSummary[] {
  const rows = db
    .select({ s: sessions, unitTitle: units.title, unitKind: units.kind })
    .from(sessions)
    .innerJoin(units, eq(units.id, sessions.unitId))
    .where(eq(sessions.courseId, courseId))
    .orderBy(desc(sessions.updatedAt))
    .all();
  return rows.map(({ s, unitTitle, unitKind }) => {
    const sqs = db.select({ status: sessionQuestions.status, closed: sessionQuestions.closed }).from(sessionQuestions).where(eq(sessionQuestions.sessionId, s.id)).all();
    const report = db.select({ id: reports.id }).from(reports).where(eq(reports.sessionId, s.id)).orderBy(desc(reports.createdAt)).get();
    const done = s.mode === 'ei_examen' ? sqs.filter((x) => x.status !== 'unseen' && x.status !== 'seen').length : sqs.filter((x) => x.closed).length;
    return {
      id: s.id,
      unitId: s.unitId,
      unitTitle,
      unitKind,
      mode: s.mode,
      status: s.status,
      progress: { done, total: sqs.length },
      score: s.score,
      reportId: report?.id ?? null,
      reviewQuizId: s.reviewQuizId,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  });
}

// ---------- Présence / chronomètre ----------

export function heartbeat(id: string, questionId: string | null, visible: boolean): HeartbeatResponse {
  const s = loadSession(id);
  if (s.status !== 'in_progress') return { locks: null, elapsedSec: Math.floor(s.elapsedSec), timeUp: false, status: s.status };
  const now = Date.now();
  const elapsedSec = s.elapsedSec + heartbeatDelta(s.lastTickAt, now, config.heartbeatCapMs) / 1000;
  touchSession(id, { lastTickAt: now, elapsedSec });

  let locks: HeartbeatResponse['locks'] = null;
  if (questionId && questionId === s.currentQuestionId) {
    const sq = loadSq(id, questionId);
    if (visible) {
      const activeMs = sq.activeMs + heartbeatDelta(sq.lastHeartbeatAt, now, config.heartbeatCapMs);
      updateSq(id, questionId, { activeMs, lastHeartbeatAt: now });
      sq.activeMs = activeMs;
    } else {
      updateSq(id, questionId, { lastHeartbeatAt: null });
    }
    locks = locksFor(s, sq, attemptsFor(id, questionId));
  }

  if (s.timeLimitSec && elapsedSec >= s.timeLimitSec) {
    finishSession(id);
    return { locks: null, elapsedSec: Math.floor(elapsedSec), timeUp: true, status: 'reporting' };
  }
  return { locks, elapsedSec: Math.floor(elapsedSec), timeUp: false, status: s.status };
}

// ---------- Aides ----------

export async function requestHelp(id: string, questionId: string, kind: HelpKind, onText: (d: string) => void): Promise<HelpEventDto> {
  const s = loadSession(id);
  requireActive(s);
  requireHelpsAllowed(s);
  requireCurrent(s, questionId);
  const sq = loadSq(id, questionId);
  const locks = locksFor(s, sq, attemptsFor(id, questionId));
  if (kind === 'hint' && !locks.hint.unlocked) throw new HttpError(423, locks.hint.reason || "L'indice n'est pas encore débloqué.");
  if (kind === 'solution' && !locks.solution.unlocked) throw new HttpError(423, locks.solution.reason || "La solution n'est pas encore débloquée.");

  const existing = eventsFor(id, questionId).find((e) => e.kind === kind);
  if (existing) return eventDto(existing);

  const atMs = sq.activeMs;
  let contentMd = '';
  let data: EventRow['data'] = null;
  if (kind === 'reformulation') {
    contentMd = (await tutor.reformulate(questionId, onText)).contentMd;
  } else if (kind === 'course_refs') {
    const r = await tutor.courseRefs(questionId);
    contentMd = r.contentMd;
    data = { courseRefs: r.refs };
  } else if (kind === 'hint') {
    contentMd = (await tutor.hint(questionId, onText)).contentMd;
  } else {
    const r = await tutor.referenceSolution(questionId, onText);
    contentMd = r.contentMd;
    data = { source: r.source, auto: sq.closed };
  }

  // Jalons et drapeaux enregistrés une fois l'aide obtenue (au temps actif de la demande).
  const fresh = loadSq(id, questionId);
  const flags = { ...fresh.flags };
  const patch: Partial<SqRow> = {};
  if (kind === 'reformulation') flags.reformulate = true;
  if (kind === 'course_refs') {
    flags.courseRefs = true;
    if (fresh.courseRefsAtMs === null) patch.courseRefsAtMs = atMs;
  }
  if (kind === 'hint') {
    flags.hint = true;
    if (fresh.hintAtMs === null) patch.hintAtMs = atMs;
  }
  if (kind === 'solution') {
    patch.solutionUnlocked = true;
    if (!fresh.closed) flags.solution = true;
  }
  updateSq(id, questionId, { ...patch, flags });
  touchSession(id);

  const ev = db
    .insert(sessionEvents)
    .values({ id: newId(), sessionId: id, questionId, kind, contentMd, data })
    .returning()
    .get();
  return eventDto(ev);
}

// ---------- Réponses ----------

function parseDataUrl(dataUrl: string): { ext: 'png' | 'jpg'; buf: Buffer } {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new HttpError(400, 'Image invalide (PNG ou JPEG attendu).');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 12 * 1024 * 1024) throw new HttpError(413, 'Image trop lourde (12 Mo max).');
  return { ext: m[1] === 'png' ? 'png' : 'jpg', buf };
}

export async function saveImage(dataUrl: string, name: string): Promise<string> {
  const { ext, buf } = parseDataUrl(dataUrl);
  const path = join(config.answersDir, `${name}.${ext}`);
  await writeFile(path, buf);
  return path;
}

export async function submitAttempt(id: string, body: SubmitAttemptBody): Promise<SubmitAttemptResponse> {
  const s = loadSession(id);
  requireActive(s);
  requireCurrent(s, body.questionId);
  const sq = loadSq(id, body.questionId);
  if (sq.closed) throw new HttpError(409, 'Cette question est déjà terminée.');
  const previous = attemptsFor(id, body.questionId);
  if (s.mode !== 'ei_examen' && previous.some((a) => a.verdict === 'correct')) {
    throw new HttpError(409, 'Tu as déjà répondu correctement à cette question.');
  }

  const type = body.type;
  const text = body.text?.trim() || null;
  const code = body.code?.trim() || null;
  if (type === 'text' && !text) throw new HttpError(400, 'Ta réponse est vide.');
  if (type === 'code' && !code) throw new HttpError(400, 'Ton code est vide.');
  if (type === 'image' && !body.imageDataUrl) throw new HttpError(400, 'Ajoute une photo de ta copie.');

  const attemptId = newId();
  const imagePath = type === 'image' && body.imageDataUrl ? await saveImage(body.imageDataUrl, attemptId) : null;
  const answer = { type, text, code, codeLang: body.codeLang ?? null, imagePath };

  let verdict: AttemptRow['verdict'] = 'pending';
  let hidden: AttemptRow['hidden'] = null;
  if (s.mode !== 'ei_examen') {
    const v = await tutor.verifyAnswer(body.questionId, answer);
    verdict = v.verdict;
    hidden = { errorLocation: v.errorLocation, errorExplanation: v.errorExplanation };
  }

  const fresh = loadSq(id, body.questionId);
  const row = db
    .insert(attempts)
    .values({
      id: attemptId,
      sessionId: id,
      questionId: body.questionId,
      type,
      answerText: text,
      code,
      codeLang: answer.codeLang,
      imagePath,
      verdict,
      hidden,
      submittedAtMs: fresh.activeMs,
    })
    .returning()
    .get();

  const flags = { ...fresh.flags };
  let status = fresh.status;
  if (verdict === 'correct') status = 'correct';
  else if (verdict === 'incorrect' || verdict === 'partiel') {
    status = 'wrong';
    flags.wrongAttempts += 1;
  }
  updateSq(id, body.questionId, { status, flags });
  touchSession(id);

  const list = attemptsFor(id, body.questionId);
  return { attempt: attemptDto(row), locks: locksFor(s, { ...fresh, status, flags }, list), status };
}

export function revealError(id: string, attemptId: string, what: 'location' | 'explanation') {
  const s = loadSession(id);
  requireActive(s);
  requireHelpsAllowed(s);
  const a = db.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.sessionId, id))).get() ?? notFound('Tentative');
  requireCurrent(s, a.questionId);
  const sq = loadSq(id, a.questionId);
  const list = attemptsFor(id, a.questionId);
  const locks = locksFor(s, sq, list);
  if (!locks.error || locks.error.attemptId !== attemptId) throw new HttpError(409, 'Seule la dernière réponse fausse peut être détaillée.');

  const already = a.revealed.includes(what);
  if (!already) {
    const lock = what === 'location' ? locks.error.showError : locks.error.explainError;
    if (!lock.unlocked) throw new HttpError(423, lock.reason || 'Pas encore disponible.');
    db.update(attempts)
      .set({
        revealed: [...a.revealed, what],
        ...(what === 'location' ? { shownAtMs: sq.activeMs } : { explainedAtMs: sq.activeMs }),
      })
      .where(eq(attempts.id, attemptId))
      .run();
    const contentMd = (what === 'location' ? a.hidden?.errorLocation : a.hidden?.errorExplanation) ?? '';
    db.insert(sessionEvents)
      .values({ id: newId(), sessionId: id, questionId: a.questionId, attemptId, kind: what === 'location' ? 'error_location' : 'error_explanation', contentMd })
      .run();
    touchSession(id);
  }
  const updated = db.select().from(attempts).where(eq(attempts.id, attemptId)).get()!;
  return { attempt: attemptDto(updated), locks: locksFor(s, loadSq(id, a.questionId), attemptsFor(id, a.questionId)) };
}

// ---------- Navigation ----------

/** Termine la question en cours (passage à la suite) ; la solution sera affichée en transition. */
export function closeQuestion(id: string, questionId: string, struggled?: boolean | null) {
  const s = loadSession(id);
  requireActive(s);
  requireCurrent(s, questionId);
  if (s.mode === 'ei_examen') throw new HttpError(400, 'Utilise « Question suivante » en mode examen.');
  const sq = loadSq(id, questionId);
  if (sq.closed) return getSessionState(id);
  const list = attemptsFor(id, questionId);
  const flags = { ...sq.flags };
  let status = sq.status;
  if (list.length === 0) {
    if (struggled === undefined || struggled === null) throw new HttpError(409, 'Indique si tu as eu du mal sur cette question.', 'struggle_required');
    flags.selfStruggle = struggled;
    status = 'skipped';
  } else if (!list.some((a) => a.verdict === 'correct')) {
    status = 'wrong';
  }
  updateSq(id, questionId, { closed: true, solutionUnlocked: true, status, flags, lastHeartbeatAt: null });
  touchSession(id);
  return getSessionState(id);
}

/** Passe à la question suivante (ou termine la session). */
export function advance(id: string) {
  const s = loadSession(id);
  requireActive(s);
  const sqs = db.select().from(sessionQuestions).where(eq(sessionQuestions.sessionId, id)).orderBy(asc(sessionQuestions.order)).all();
  const cur = sqs.find((x) => x.questionId === s.currentQuestionId);
  if (s.mode !== 'ei_examen' && cur && !cur.closed) throw new HttpError(409, 'Termine d’abord la question en cours.');

  let next: SqRow | undefined;
  if (s.mode === 'ei_examen') {
    next = sqs.find((x) => cur && x.order > cur.order);
  } else {
    next = sqs.find((x) => !x.closed && (!cur || x.order > cur.order)) ?? sqs.find((x) => !x.closed);
  }
  if (!next) {
    if (s.mode === 'ei_examen') return getSessionState(id);
    finishSession(id);
    return getSessionState(id);
  }
  goTo(s, next);
  return getSessionState(id);
}

function goTo(s: SessionRow, sq: SqRow) {
  if (s.currentQuestionId && s.currentQuestionId !== sq.questionId) updateSq(s.id, s.currentQuestionId, { lastHeartbeatAt: null });
  if (sq.status === 'unseen') updateSq(s.id, sq.questionId, { status: 'seen' });
  touchSession(s.id, { currentQuestionId: sq.questionId });
}

/** Mode examen : navigation libre entre les questions. */
export function gotoQuestion(id: string, questionId: string) {
  const s = loadSession(id);
  requireActive(s);
  if (s.mode !== 'ei_examen') throw new HttpError(400, 'Navigation libre réservée au mode examen.');
  goTo(s, loadSq(id, questionId));
  return getSessionState(id);
}

export function finishSession(id: string) {
  const s = loadSession(id);
  if (s.status !== 'in_progress') return;
  touchSession(id, { status: 'reporting', finishedAt: Date.now() });
  if (!hasPendingJob('report', { refId: id })) enqueueJob({ type: 'report', courseId: s.courseId, refId: id });
}

export function deleteSession(id: string) {
  db.delete(sessions).where(eq(sessions.id, id)).run();
}
