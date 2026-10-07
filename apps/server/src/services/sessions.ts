// Séances de TD/TP/EI : création, état du lecteur, présence (temps actif), aides, réponses et navigation.
// Les verrous temporels sont calculés ici à partir du temps actif enregistré ; le calcul lui-même est dans unlocks.ts.
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  EMPTY_FLAGS,
  isPlayableKind,
  type AttemptDto,
  type HeartbeatResponse,
  type HelpEventDto,
  type HelpKind,
  type LocksDto,
  type QuestionFlags,
  type QuestionView,
  type SessionMode,
  type SessionState,
  type SessionSummary,
  type SubmitAttemptBody,
  type SubmitAttemptResponse,
} from '@tpassist/shared';
import { config } from '../config';
import { db, newId } from '../db/client';
import { findById, orderedQuestions, questionWithContext, type QuestionContext } from '../db/repo';
import { attempts, courses, sessionEvents, sessionQuestions, sessions, units } from '../db/schema';
import { HttpError, notFound } from '../errors';
import { enqueueJob, hasPendingJob } from '../jobs/queue';
import { pageImageUrl } from '../pdf/render';
import { saveImage } from './images';
import { latestReport } from './reports';
import * as tutor from './tutor';
import { computeLocks, heartbeatDelta } from './unlocks';

type SessionRow = typeof sessions.$inferSelect;
type SqRow = typeof sessionQuestions.$inferSelect;
type AttemptRow = typeof attempts.$inferSelect;
type EventRow = typeof sessionEvents.$inferSelect;

/** Durée d'une EI quand le sujet n'en indique pas. */
const DEFAULT_EI_SECONDS = 2 * 3600;

// ---------- Chargement ----------

/** Séance par son id ; 404 si elle n'existe pas. */
function loadSession(id: string): SessionRow {
  return findById(sessions, id, 'Session');
}

/** Suivi d'une question dans une séance ; 404 s'il n'existe pas. */
export function loadSq(sessionId: string, questionId: string): SqRow {
  return (
    db
      .select()
      .from(sessionQuestions)
      .where(and(eq(sessionQuestions.sessionId, sessionId), eq(sessionQuestions.questionId, questionId)))
      .get() ?? notFound('Question de session')
  );
}

/** Met à jour le suivi d'une question dans une séance. */
export function updateSq(sessionId: string, questionId: string, patch: Partial<SqRow>) {
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

function sessionQuestionsOf(sessionId: string): SqRow[] {
  return db.select().from(sessionQuestions).where(eq(sessionQuestions.sessionId, sessionId)).orderBy(asc(sessionQuestions.order)).all();
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

/** URL de la photo d'une tentative. */
export function attemptImageUrl(attemptId: string): string {
  return `/api/attempts/${attemptId}/image`;
}

function attemptDto(a: AttemptRow): AttemptDto {
  return {
    id: a.id,
    type: a.type,
    text: a.answerText,
    code: a.code,
    codeLang: a.codeLang,
    imageUrl: a.imagePath ? attemptImageUrl(a.id) : null,
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

function questionView({ q, ex }: QuestionContext): QuestionView {
  return {
    id: q.id,
    label: q.label,
    exerciseTitle: ex.title,
    contextMd: ex.contextMd,
    statementMd: q.statementMd,
    figures: q.documentId ? q.figurePages.map((page) => ({ page, url: pageImageUrl(q.documentId!, page) })) : [],
    points: q.points,
  };
}

/** Verrous des aides d'une question de la séance (tentatives lues en base si elles ne sont pas fournies). */
export function questionLocks(s: SessionRow, sq: SqRow, list: AttemptRow[] = attemptsFor(s.id, sq.questionId)): LocksDto {
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

/**
 * Lance une séance sur un TD, un TP ou une EI.
 * Le mode est corrigé selon le type (un TD/TP est toujours en entraînement, une EI jamais).
 * @param timeLimitSec durée choisie pour une EI (sinon celle du sujet, ou 2 h)
 * @throws HttpError 400 pour un cours ou un corrigé, ou une partie sans question
 */
export function createSession(unitId: string, mode: SessionMode, timeLimitSec?: number | null): SessionRow {
  const unit = findById(units, unitId, 'Partie');
  if (!isPlayableKind(unit.kind)) throw new HttpError(400, 'Seuls les TD, TP et EI peuvent être lancés.');
  const isEi = unit.kind === 'ei';
  if (isEi && mode === 'tp') mode = 'ei_aides';
  if (!isEi) mode = 'tp';
  const qs = orderedQuestions(unitId);
  if (qs.length === 0) throw new HttpError(400, "Aucune question n'a été détectée dans cette partie. Corrige-la dans l'éditeur.");

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
      timeLimitSec: isEi ? (timeLimitSec ?? (unit.meta.durationMinutes ? unit.meta.durationMinutes * 60 : DEFAULT_EI_SECONDS)) : null,
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

/** État complet du lecteur : séance, barre de progression et question affichée. */
export function getSessionState(id: string): SessionState {
  const s = loadSession(id);
  const unit = findById(units, s.unitId, 'Partie');
  const course = findById(courses, s.courseId, 'Cours');
  const sqs = sessionQuestionsOf(id);
  const byQ = new Map(orderedQuestions(s.unitId).map((r) => [r.q.id, r]));
  const answered = new Set(
    db
      .select({ q: attempts.questionId })
      .from(attempts)
      .where(eq(attempts.sessionId, id))
      .all()
      .map((r) => r.q),
  );

  let current: SessionState['current'] = null;
  const sq = s.status === 'in_progress' ? sqs.find((x) => x.questionId === s.currentQuestionId) : undefined;
  if (sq) {
    const list = attemptsFor(id, sq.questionId);
    current = {
      question: questionView(questionWithContext(sq.questionId)),
      status: sq.status,
      closed: sq.closed,
      events: eventsFor(id, sq.questionId).map(eventDto),
      attempts: list.map(attemptDto),
      locks: questionLocks(s, sq, list),
    };
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
      reportId: latestReport(id)?.id ?? null,
    },
    outline: sqs.flatMap((x) => {
      const r = byQ.get(x.questionId);
      return r ? [{ id: x.questionId, label: r.q.label, exerciseTitle: r.ex.title, status: x.status, answered: answered.has(x.questionId) }] : [];
    }),
    currentQuestionId: s.currentQuestionId,
    current,
  };
}

/** Séances d'un cours pour l'historique, de la plus récente à la plus ancienne. */
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
    // En mode examen, une question est « faite » dès qu'elle a été traitée (aucune n'est fermée avant la fin).
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
      reportId: latestReport(s.id)?.id ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  });
}

// ---------- Présence / chronomètre ----------

/**
 * Signal de présence envoyé par le lecteur toutes les 5 s : avance le chronomètre de la séance et,
 * si la page est visible, le temps actif de la question en cours (qui débloque les aides).
 * Termine la séance quand le temps d'une EI est écoulé.
 */
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
      sq.activeMs += heartbeatDelta(sq.lastHeartbeatAt, now, config.heartbeatCapMs);
      updateSq(id, questionId, { activeMs: sq.activeMs, lastHeartbeatAt: now });
    } else {
      updateSq(id, questionId, { lastHeartbeatAt: null });
    }
    locks = questionLocks(s, sq);
  }

  if (s.timeLimitSec && elapsedSec >= s.timeLimitSec) {
    finishSession(id);
    return { locks: null, elapsedSec: Math.floor(elapsedSec), timeUp: true, status: 'reporting' };
  }
  return { locks, elapsedSec: Math.floor(elapsedSec), timeUp: false, status: s.status };
}

// ---------- Aides ----------

interface HelpResult {
  contentMd: string;
  data: EventRow['data'];
}

/**
 * Pour chaque aide : comment l'obtenir, et ce qu'elle change sur la question une fois obtenue
 * (drapeaux de difficulté, jalons de temps actif qui démarrent les verrous suivants).
 * Ajouter une aide revient à ajouter une entrée ici.
 */
const HELP_ACTIONS: Record<HelpKind, { run: (questionId: string, sq: SqRow, onText: (d: string) => void) => Promise<HelpResult>; mark: (flags: QuestionFlags, sq: SqRow, atMs: number) => Partial<SqRow> }> = {
  reformulation: {
    run: async (questionId, _sq, onText) => ({ contentMd: (await tutor.reformulate(questionId, onText)).contentMd, data: null }),
    mark: (flags) => {
      flags.reformulate = true;
      return {};
    },
  },
  course_refs: {
    run: async (questionId) => {
      const r = await tutor.courseRefs(questionId);
      return { contentMd: r.contentMd, data: { courseRefs: r.refs } };
    },
    mark: (flags, sq, atMs) => {
      flags.courseRefs = true;
      return sq.courseRefsAtMs === null ? { courseRefsAtMs: atMs } : {};
    },
  },
  hint: {
    run: async (questionId, _sq, onText) => ({ contentMd: (await tutor.hint(questionId, onText)).contentMd, data: null }),
    mark: (flags, sq, atMs) => {
      flags.hint = true;
      return sq.hintAtMs === null ? { hintAtMs: atMs } : {};
    },
  },
  solution: {
    run: async (questionId, sq, onText) => {
      const r = await tutor.referenceSolution(questionId, onText);
      // `auto` : solution affichée en transition après la fermeture de la question (pas une aide demandée).
      return { contentMd: r.contentMd, data: { source: r.source, auto: sq.closed } };
    },
    mark: (flags, sq) => {
      if (!sq.closed) flags.solution = true;
      return { solutionUnlocked: true };
    },
  },
};

/**
 * Obtient une aide sur la question en cours (diffusée au fil de l'eau) et l'enregistre dans la séance.
 * Une aide déjà obtenue est renvoyée telle quelle.
 * @throws HttpError 403 en mode examen, 409 si la question n'est plus la question en cours, 423 si l'aide est verrouillée
 */
export async function requestHelp(id: string, questionId: string, kind: HelpKind, onText: (d: string) => void): Promise<HelpEventDto> {
  const s = loadSession(id);
  requireActive(s);
  requireHelpsAllowed(s);
  requireCurrent(s, questionId);
  const sq = loadSq(id, questionId);
  const locks = questionLocks(s, sq);
  if (kind === 'hint' && !locks.hint.unlocked) throw new HttpError(423, locks.hint.reason || "L'indice n'est pas encore débloqué.");
  if (kind === 'solution' && !locks.solution.unlocked) throw new HttpError(423, locks.solution.reason || "La solution n'est pas encore débloquée.");

  const existing = eventsFor(id, questionId).find((e) => e.kind === kind);
  if (existing) return eventDto(existing);

  const action = HELP_ACTIONS[kind];
  const atMs = sq.activeMs;
  const { contentMd, data } = await action.run(questionId, sq, onText);

  // Jalons et drapeaux enregistrés une fois l'aide obtenue, au temps actif de la demande.
  const fresh = loadSq(id, questionId);
  const flags = { ...fresh.flags };
  updateSq(id, questionId, { ...action.mark(flags, fresh, atMs), flags });
  touchSession(id);

  const ev = db.insert(sessionEvents).values({ id: newId(), sessionId: id, questionId, kind, contentMd, data }).returning().get();
  return eventDto(ev);
}

// ---------- Réponses ----------

/**
 * Enregistre une réponse à la question en cours et la fait corriger par l'IA (sauf en mode examen,
 * où elle est corrigée dans le bilan).
 * @throws HttpError 400 si la réponse est vide, 409 si la question est fermée ou déjà réussie
 */
export async function submitAttempt(id: string, body: SubmitAttemptBody): Promise<SubmitAttemptResponse> {
  const s = loadSession(id);
  requireActive(s);
  requireCurrent(s, body.questionId);
  const sq = loadSq(id, body.questionId);
  if (sq.closed) throw new HttpError(409, 'Cette question est déjà terminée.');
  if (s.mode !== 'ei_examen' && attemptsFor(id, body.questionId).some((a) => a.verdict === 'correct')) {
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
    .values({ id: attemptId, sessionId: id, questionId: body.questionId, type, answerText: text, code, codeLang: answer.codeLang, imagePath, verdict, hidden, submittedAtMs: fresh.activeMs })
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
  return { attempt: attemptDto(row), locks: questionLocks(s, { ...fresh, status, flags }), status };
}

/**
 * Dévoile l'emplacement puis l'explication de l'erreur de la dernière réponse fausse, quand leur délai est écoulé.
 * @throws HttpError 409 si ce n'est pas la dernière réponse fausse, 423 si l'étape est encore verrouillée
 */
export function revealError(id: string, attemptId: string, what: 'location' | 'explanation') {
  const s = loadSession(id);
  requireActive(s);
  requireHelpsAllowed(s);
  const a = db.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.sessionId, id))).get() ?? notFound('Tentative');
  requireCurrent(s, a.questionId);
  const sq = loadSq(id, a.questionId);
  const locks = questionLocks(s, sq);
  if (!locks.error || locks.error.attemptId !== attemptId) throw new HttpError(409, 'Seule la dernière réponse fausse peut être détaillée.');

  if (!a.revealed.includes(what)) {
    const lock = what === 'location' ? locks.error.showError : locks.error.explainError;
    if (!lock.unlocked) throw new HttpError(423, lock.reason || 'Pas encore disponible.');
    db.update(attempts)
      .set({ revealed: [...a.revealed, what], ...(what === 'location' ? { shownAtMs: sq.activeMs } : { explainedAtMs: sq.activeMs }) })
      .where(eq(attempts.id, attemptId))
      .run();
    const contentMd = (what === 'location' ? a.hidden?.errorLocation : a.hidden?.errorExplanation) ?? '';
    db.insert(sessionEvents)
      .values({ id: newId(), sessionId: id, questionId: a.questionId, attemptId, kind: what === 'location' ? 'error_location' : 'error_explanation', contentMd })
      .run();
    touchSession(id);
  }
  const updated = db.select().from(attempts).where(eq(attempts.id, attemptId)).get()!;
  return { attempt: attemptDto(updated), locks: questionLocks(s, loadSq(id, a.questionId)) };
}

// ---------- Navigation ----------

/**
 * Termine la question en cours.
 * - Après une bonne réponse : la solution expliquée est affichée en transition avant de continuer.
 * - `skip` (« Passer la question ») : on enchaîne directement sur la question suivante, sans solution ;
 *   elle reste consultable dans le bilan.
 * @param struggled réponse à « As-tu galéré ? », obligatoire si aucune réponse n'a été proposée
 * @throws HttpError 409 `struggle_required` si `struggled` manque alors qu'il est obligatoire
 */
export function closeQuestion(id: string, questionId: string, struggled?: boolean | null, opts: { skip?: boolean } = {}) {
  const s = loadSession(id);
  requireActive(s);
  requireCurrent(s, questionId);
  if (s.mode === 'ei_examen') throw new HttpError(400, 'Utilise « Question suivante » en mode examen.');
  const sq = loadSq(id, questionId);
  if (!sq.closed) {
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
  }
  return opts.skip ? advance(id) : getSessionState(id);
}

/**
 * Passe à la question suivante. En entraînement, revient sur une question non terminée s'il en reste,
 * et termine la séance sinon ; en mode examen, avance simplement dans l'ordre.
 * @throws HttpError 409 si la question en cours n'est pas terminée (hors mode examen)
 */
export function advance(id: string) {
  const s = loadSession(id);
  requireActive(s);
  const sqs = sessionQuestionsOf(id);
  const cur = sqs.find((x) => x.questionId === s.currentQuestionId);
  const exam = s.mode === 'ei_examen';
  if (!exam && cur && !cur.closed) throw new HttpError(409, 'Termine d’abord la question en cours.');

  const next = exam
    ? sqs.find((x) => cur && x.order > cur.order)
    : (sqs.find((x) => !x.closed && (!cur || x.order > cur.order)) ?? sqs.find((x) => !x.closed));
  if (next) goTo(s, next);
  else if (!exam) finishSession(id);
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

/** Termine la séance et lance la rédaction du bilan (une seule fois). */
export function finishSession(id: string) {
  const s = loadSession(id);
  if (s.status !== 'in_progress') return;
  touchSession(id, { status: 'reporting', finishedAt: Date.now() });
  if (!hasPendingJob('report', { refId: id })) enqueueJob({ type: 'report', courseId: s.courseId, refId: id });
}
