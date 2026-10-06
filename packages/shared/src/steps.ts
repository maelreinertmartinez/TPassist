// Étapes des boutons d'aide « successifs » du lecteur de TD/TP.
// Le serveur reste maître des verrous : ces fonctions ne font que choisir l'étape à proposer.
import type { AttemptDto, EventKind, LockInfo, LocksDto } from './index';

const OPEN: LockInfo = { unlocked: true, remainingMs: 0 };

export type HelpStep = 'course_refs' | 'hint' | 'solution' | 'done';

/** Bouton d'aide : partie de cours → (délai) indice → (délai) solution. */
export function nextHelpStep(events: { kind: EventKind }[], locks: LocksDto | null): { step: HelpStep; lock: LockInfo | null } {
  const has = (k: EventKind) => events.some((e) => e.kind === k);
  if (has('solution')) return { step: 'done', lock: null };
  if (!has('course_refs')) return { step: 'course_refs', lock: OPEN };
  if (!has('hint')) return { step: 'hint', lock: locks?.hint ?? null };
  return { step: 'solution', lock: locks?.solution ?? null };
}

export type ErrorStep = 'location' | 'explanation' | 'solution' | 'done';

/**
 * Bouton d'erreur d'une réponse fausse : montrer → (délai) expliquer → (délai) solution.
 * Localiser et expliquer l'erreur restent utiles même si la solution est déjà affichée.
 */
export function nextErrorStep(
  attempt: Pick<AttemptDto, 'id' | 'revealed'>,
  locks: LocksDto | null,
  solutionShown: boolean,
): { step: ErrorStep; lock: LockInfo | null } {
  const chain = locks?.error && locks.error.attemptId === attempt.id ? locks.error : null;
  if (attempt.revealed.location === undefined) return { step: 'location', lock: chain?.showError ?? null };
  if (attempt.revealed.explanation === undefined) return { step: 'explanation', lock: chain?.explainError ?? null };
  if (solutionShown) return { step: 'done', lock: null };
  return { step: 'solution', lock: chain?.solution ?? null };
}
