import { nextErrorStep, nextHelpStep, type EventKind, type LockInfo, type LocksDto } from '@tpassist/shared';
import { describe, expect, it } from 'vitest';

const open: LockInfo = { unlocked: true, remainingMs: 0 };
const wait = (ms: number): LockInfo => ({ unlocked: false, remainingMs: ms });
const needs = (reason: string): LockInfo => ({ unlocked: false, remainingMs: null, reason });

const locks = (over: Partial<LocksDto> = {}): LocksDto => ({
  activeMs: 0,
  delayMs: 120_000,
  hint: needs('cours'),
  solution: needs('indice'),
  error: null,
  ...over,
});
const ev = (...kinds: EventKind[]) => kinds.map((kind) => ({ kind }));

describe('bouton d’aide unique', () => {
  it('commence par la partie de cours, toujours disponible', () => {
    expect(nextHelpStep([], locks())).toEqual({ step: 'course_refs', lock: open });
  });
  it('la reformulation ne fait pas avancer le bouton', () => {
    expect(nextHelpStep(ev('reformulation'), locks()).step).toBe('course_refs');
  });
  it('puis l’indice, avec son compte à rebours', () => {
    expect(nextHelpStep(ev('course_refs'), locks({ hint: wait(90_000) }))).toEqual({ step: 'hint', lock: wait(90_000) });
    expect(nextHelpStep(ev('course_refs'), locks({ hint: open })).lock).toEqual(open);
  });
  it('puis la solution', () => {
    expect(nextHelpStep(ev('course_refs', 'hint'), locks({ hint: open, solution: wait(30_000) }))).toEqual({ step: 'solution', lock: wait(30_000) });
  });
  it('disparaît une fois la solution affichée, même obtenue par le parcours d’erreur', () => {
    expect(nextHelpStep(ev('course_refs', 'hint', 'solution'), locks()).step).toBe('done');
    expect(nextHelpStep(ev('solution'), locks()).step).toBe('done');
  });
  it('sans verrous connus (chargement) : étape proposée mais verrou inconnu', () => {
    expect(nextHelpStep(ev('course_refs'), null)).toEqual({ step: 'hint', lock: null });
  });
});

describe('bouton d’erreur unique', () => {
  const chain = { attemptId: 'a', showError: wait(60_000), explainError: needs('montrer'), solution: needs('expliquer') };
  it('montre d’abord l’erreur, avec son délai', () => {
    expect(nextErrorStep({ id: 'a', revealed: {} }, locks({ error: chain }), false)).toEqual({ step: 'location', lock: wait(60_000) });
  });
  it('puis l’explication, puis la solution', () => {
    const l = locks({ error: { ...chain, showError: open, explainError: wait(5_000), solution: wait(125_000) } });
    expect(nextErrorStep({ id: 'a', revealed: { location: 'x' } }, l, false)).toEqual({ step: 'explanation', lock: wait(5_000) });
    expect(nextErrorStep({ id: 'a', revealed: { location: 'x', explanation: 'y' } }, l, false)).toEqual({ step: 'solution', lock: wait(125_000) });
  });
  it('la localisation reste proposée si la solution est déjà affichée, mais pas la solution', () => {
    expect(nextErrorStep({ id: 'a', revealed: {} }, locks({ error: chain }), true).step).toBe('location');
    expect(nextErrorStep({ id: 'a', revealed: { location: 'x', explanation: 'y' } }, locks({ error: chain }), true).step).toBe('done');
  });
  it('une tentative qui n’est plus la dernière n’a pas de verrou ouvert', () => {
    expect(nextErrorStep({ id: 'ancienne', revealed: {} }, locks({ error: chain }), false)).toEqual({ step: 'location', lock: null });
  });
});
