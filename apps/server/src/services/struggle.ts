import type { QuestionFlags } from '@tpassist/shared';

/** Poids de difficulté d'une question à partir des aides utilisées et des erreurs. */
export function struggleWeight(f: QuestionFlags): number {
  return (
    (f.solution ? 3 : 0) +
    Math.min(f.wrongAttempts * 2, 4) +
    (f.selfStruggle ? 2 : 0) +
    (f.hint ? 1 : 0) +
    (f.courseRefs ? 1 : 0) +
    (f.reformulate ? 1 : 0) +
    (f.chat > 0 ? 1 : 0)
  );
}

export function isStruggle(f: QuestionFlags): boolean {
  return struggleWeight(f) > 0;
}

/** Taille du quiz de révision : somme des ceil(poids/2), bornée entre 3 et 20. */
export function reviewQuizSize(flags: QuestionFlags[]): { size: number; noStruggle: boolean } {
  const total = flags.reduce((acc, f) => acc + Math.ceil(struggleWeight(f) / 2), 0);
  if (total === 0) return { size: 5, noStruggle: true };
  return { size: Math.max(3, Math.min(20, total)), noStruggle: false };
}

/** Libellés des aides utilisées (pour le bilan). */
export function helpLabels(f: QuestionFlags): string[] {
  const out: string[] = [];
  if (f.reformulate) out.push('Reformulation');
  if (f.courseRefs) out.push('Partie de cours');
  if (f.hint) out.push('Indice');
  if (f.solution) out.push('Solution demandée');
  if (f.wrongAttempts > 0) out.push(`${f.wrongAttempts} réponse(s) fausse(s)`);
  if (f.selfStruggle) out.push('Difficulté signalée');
  if (f.chat > 0) out.push(`${f.chat} question(s) au chat`);
  return out;
}
