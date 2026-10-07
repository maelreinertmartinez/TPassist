// Verrous temporels des aides : fonctions pures, sans accès à la base (testées dans test/unlocks.test.ts).
import type { LockInfo, LocksDto, SessionMode, Verdict } from '@tpassist/shared';

/** Ce qu'il faut savoir d'une tentative pour calculer les verrous (temps actifs en ms). */
export interface LockAttempt {
  id: string;
  verdict: Verdict;
  submittedAtMs: number;
  shownAtMs: number | null;
  explainedAtMs: number | null;
}

/** État d'une question dans une séance, tel qu'enregistré en base. */
export interface LockInputs {
  mode: SessionMode;
  activeMs: number;
  delayMs: number;
  closed: boolean;
  courseRefsAtMs: number | null;
  hintAtMs: number | null;
  solutionUnlocked: boolean;
  /** Tentatives dans l'ordre chronologique. */
  attempts: LockAttempt[];
}

const isWrong = (v: Verdict) => v === 'incorrect' || v === 'partiel';

function lockAt(threshold: number | null, activeMs: number, reason: string): LockInfo {
  if (threshold === null) return { unlocked: false, remainingMs: null, reason };
  const remaining = threshold - activeMs;
  return remaining <= 0 ? { unlocked: true, remainingMs: 0 } : { unlocked: false, remainingMs: remaining };
}

const UNLOCKED: LockInfo = { unlocked: true, remainingMs: 0 };

/**
 * Calcule l'état des verrous des aides d'une question, en temps actif passé sur la question.
 * - Chaîne « aides » : partie de cours → (délai) → indice → (délai) → solution.
 * - Chaîne « erreur » (dernière tentative fausse) : soumission → (délai) → montrer l'erreur
 *   → (délai) → expliquer l'erreur → (délai) → solution.
 * - Une solution débloquée le reste, et une question fermée débloque tout.
 */
export function computeLocks(i: LockInputs): LocksDto {
  const { activeMs, delayMs } = i;
  if (i.mode === 'ei_examen') {
    const off: LockInfo = { unlocked: false, remainingMs: null, reason: 'Aides désactivées en mode examen.' };
    return { activeMs, delayMs, hint: off, solution: off, error: null };
  }

  const hint = i.closed
    ? UNLOCKED
    : lockAt(i.courseRefsAtMs === null ? null : i.courseRefsAtMs + delayMs, activeMs, 'Consulte d’abord la partie de cours.');

  // Toutes les échéances qui peuvent débloquer la solution.
  const solutionThresholds: number[] = [];
  if (i.hintAtMs !== null) solutionThresholds.push(i.hintAtMs + delayMs);
  for (const a of i.attempts) {
    if (isWrong(a.verdict) && a.explainedAtMs !== null) solutionThresholds.push(a.explainedAtMs + delayMs);
  }
  let solution: LockInfo;
  if (i.closed || i.solutionUnlocked) {
    solution = UNLOCKED;
  } else if (solutionThresholds.length === 0) {
    solution = { unlocked: false, remainingMs: null, reason: 'Demande d’abord l’indice (ou suis le parcours de correction de ton erreur).' };
  } else {
    solution = lockAt(Math.min(...solutionThresholds), activeMs, '');
  }

  const last = i.attempts[i.attempts.length - 1];
  let error: LocksDto['error'] = null;
  if (last && isWrong(last.verdict)) {
    const showError = i.closed ? UNLOCKED : lockAt(last.submittedAtMs + delayMs, activeMs, '');
    const explainError =
      i.closed
        ? UNLOCKED
        : lockAt(last.shownAtMs === null ? null : last.shownAtMs + delayMs, activeMs, 'Clique d’abord sur « Montrer où est l’erreur ».');
    const chainSolution = solution.unlocked
      ? UNLOCKED
      : lockAt(last.explainedAtMs === null ? null : last.explainedAtMs + delayMs, activeMs, 'Clique d’abord sur « Expliquer l’erreur ».');
    error = { attemptId: last.id, showError, explainError, solution: chainSolution };
  }

  return { activeMs, delayMs, hint, solution, error };
}

/** Ajoute le temps d'un signal de présence, plafonné pour ne pas compter les absences. */
export function heartbeatDelta(lastHeartbeatAt: number | null, now: number, capMs: number): number {
  if (lastHeartbeatAt === null) return 0;
  const delta = now - lastHeartbeatAt;
  if (delta <= 0) return 0;
  return Math.min(delta, capMs);
}
