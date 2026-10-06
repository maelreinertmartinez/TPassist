import { EMPTY_FLAGS, type QuestionFlags } from '@tpassist/shared';
import { describe, expect, it } from 'vitest';
import { allocateWeakPointItems } from '../src/jobs/generateQuiz';
import { helpLabels, reviewQuizSize, struggleWeight } from '../src/services/struggle';
import { applyOutcome } from '../src/services/weakPoints';

const f = (over: Partial<QuestionFlags>): QuestionFlags => ({ ...EMPTY_FLAGS, ...over });

describe('poids de difficulté', () => {
  it('aucune aide = 0', () => expect(struggleWeight(EMPTY_FLAGS)).toBe(0));
  it('cumule les aides et plafonne les erreurs', () => {
    expect(struggleWeight(f({ solution: true }))).toBe(3);
    expect(struggleWeight(f({ wrongAttempts: 1 }))).toBe(2);
    expect(struggleWeight(f({ wrongAttempts: 5 }))).toBe(4);
    expect(struggleWeight(f({ reformulate: true, courseRefs: true, hint: true, selfStruggle: true, chat: 3 }))).toBe(1 + 1 + 1 + 2 + 1);
  });
  it('libellés des aides pour le bilan', () => {
    expect(helpLabels(f({ hint: true, wrongAttempts: 2 }))).toEqual(['Indice', '2 réponse(s) fausse(s)']);
  });
});

describe('taille du quiz de révision', () => {
  it('sans difficulté : quiz court de consolidation', () => {
    expect(reviewQuizSize([EMPTY_FLAGS, EMPTY_FLAGS])).toEqual({ size: 5, noStruggle: true });
  });
  it('au moins 3 questions', () => {
    expect(reviewQuizSize([f({ reformulate: true })])).toEqual({ size: 3, noStruggle: false });
  });
  it('somme des ceil(poids/2), plafonnée à 20', () => {
    expect(reviewQuizSize([f({ solution: true, wrongAttempts: 2 }), f({ hint: true, courseRefs: true })]).size).toBe(4 + 1);
    expect(reviewQuizSize(Array.from({ length: 30 }, () => f({ solution: true }))).size).toBe(20);
  });
});

describe('points bloquants', () => {
  const s = { priority: 50, status: 'active' as const, successStreak: 0 };
  it('réussite : priorité −15, maîtrisé après 2 réussites d’affilée', () => {
    const a = applyOutcome(s, 'success');
    expect(a).toMatchObject({ priority: 35, successStreak: 1, status: 'active', delta: -15 });
    const b = applyOutcome(a, 'success');
    expect(b).toMatchObject({ priority: 20, successStreak: 2, status: 'mastered' });
  });
  it('échec : priorité +20, série remise à zéro, réactivation', () => {
    expect(applyOutcome({ priority: 30, status: 'mastered', successStreak: 2 }, 'failure')).toMatchObject({ priority: 50, successStreak: 0, status: 'active' });
    expect(applyOutcome({ priority: 50, status: 'resolved', successStreak: 0 }, 'failure').status).toBe('active');
  });
  it('difficulté rapportée : +25, plafond à 100', () => {
    expect(applyOutcome({ priority: 90, status: 'active', successStreak: 1 }, 'reported')).toMatchObject({ priority: 100, delta: 10, successStreak: 0 });
  });
  it('plancher à 0', () => expect(applyOutcome({ priority: 5, status: 'active', successStreak: 0 }, 'success').priority).toBe(0));
  it('un point résolu manuellement ne passe pas « maîtrisé » tout seul', () => {
    expect(applyOutcome({ priority: 50, status: 'resolved', successStreak: 1 }, 'success').status).toBe('resolved');
  });
});

describe('répartition des items sur les points bloquants', () => {
  it('au prorata de la priorité, total respecté', () => {
    const r = allocateWeakPointItems(
      [
        { id: 'a', priority: 80 },
        { id: 'b', priority: 40 },
        { id: 'c', priority: 0 },
      ],
      6,
    );
    expect(Object.values(r).reduce((x, y) => x + y, 0)).toBe(6);
    expect(r.a).toBeGreaterThan(r.b);
  });
  it('rien à répartir', () => {
    expect(allocateWeakPointItems([], 5)).toEqual({});
    expect(allocateWeakPointItems([{ id: 'a', priority: 10 }], 0)).toEqual({});
  });
});
