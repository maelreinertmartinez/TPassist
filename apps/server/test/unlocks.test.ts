import { describe, expect, it } from 'vitest';
import { computeLocks, heartbeatDelta, type LockAttempt, type LockInputs } from '../src/services/unlocks';

const D = 120_000;
const base = (over: Partial<LockInputs> = {}): LockInputs => ({
  mode: 'tp',
  activeMs: 0,
  delayMs: D,
  closed: false,
  courseRefsAtMs: null,
  hintAtMs: null,
  solutionUnlocked: false,
  attempts: [],
  ...over,
});
const wrong = (id: string, submittedAtMs: number, shownAtMs: number | null = null, explainedAtMs: number | null = null): LockAttempt => ({
  id,
  verdict: 'incorrect',
  submittedAtMs,
  shownAtMs,
  explainedAtMs,
});

describe('chaîne des aides : cours → indice → solution', () => {
  it("l'indice exige d'avoir demandé la partie de cours", () => {
    const l = computeLocks(base({ activeMs: 999_999 }));
    expect(l.hint.unlocked).toBe(false);
    expect(l.hint.remainingMs).toBeNull();
    expect(l.hint.reason).toMatch(/partie de cours/);
  });

  it("l'indice se débloque 2 min après la partie de cours", () => {
    expect(computeLocks(base({ courseRefsAtMs: 10_000, activeMs: 60_000 })).hint).toEqual({ unlocked: false, remainingMs: 70_000 });
    expect(computeLocks(base({ courseRefsAtMs: 10_000, activeMs: 130_000 })).hint.unlocked).toBe(true);
  });

  it("la solution exige l'indice puis 2 min", () => {
    expect(computeLocks(base({ courseRefsAtMs: 0, activeMs: 500_000 })).solution.remainingMs).toBeNull();
    const l = computeLocks(base({ courseRefsAtMs: 0, hintAtMs: 130_000, activeMs: 200_000 }));
    expect(l.solution).toEqual({ unlocked: false, remainingMs: 50_000 });
    expect(computeLocks(base({ courseRefsAtMs: 0, hintAtMs: 130_000, activeMs: 250_000 })).solution.unlocked).toBe(true);
  });
});

describe("chaîne de l'erreur", () => {
  it('montrer → expliquer → solution, à 2 min d’intervalle', () => {
    let l = computeLocks(base({ activeMs: 50_000, attempts: [wrong('a', 40_000)] }));
    expect(l.error?.showError).toEqual({ unlocked: false, remainingMs: 110_000 });
    expect(l.error?.explainError.remainingMs).toBeNull();
    expect(l.error?.solution.remainingMs).toBeNull();

    l = computeLocks(base({ activeMs: 170_000, attempts: [wrong('a', 40_000, 165_000)] }));
    expect(l.error?.showError.unlocked).toBe(true);
    expect(l.error?.explainError).toEqual({ unlocked: false, remainingMs: 115_000 });

    l = computeLocks(base({ activeMs: 300_000, attempts: [wrong('a', 40_000, 165_000, 290_000)] }));
    expect(l.error?.explainError.unlocked).toBe(true);
    expect(l.error?.solution).toEqual({ unlocked: false, remainingMs: 110_000 });
    expect(l.solution.remainingMs).toBe(110_000);

    l = computeLocks(base({ activeMs: 410_000, attempts: [wrong('a', 40_000, 165_000, 290_000)] }));
    expect(l.solution.unlocked).toBe(true);
    expect(l.error?.solution.unlocked).toBe(true);
  });

  it('une nouvelle réponse fausse relance la chaîne, mais une solution débloquée le reste', () => {
    const first = wrong('a', 0, 120_000, 240_000);
    const l = computeLocks(base({ activeMs: 400_000, attempts: [first, wrong('b', 390_000)] }));
    expect(l.error?.attemptId).toBe('b');
    expect(l.error?.showError.unlocked).toBe(false);
    expect(l.error?.explainError.remainingMs).toBeNull();
    // La solution débloquée par la première chaîne reste disponible.
    expect(l.solution.unlocked).toBe(true);
    expect(l.error?.solution.unlocked).toBe(true);
  });

  it('pas de chaîne si la dernière tentative est juste', () => {
    const l = computeLocks(base({ activeMs: 1000, attempts: [wrong('a', 0), { id: 'b', verdict: 'correct', submittedAtMs: 500, shownAtMs: null, explainedAtMs: null }] }));
    expect(l.error).toBeNull();
  });
});

describe('cas particuliers', () => {
  it('question fermée : tout est débloqué (solution de transition)', () => {
    const l = computeLocks(base({ closed: true }));
    expect(l.hint.unlocked).toBe(true);
    expect(l.solution.unlocked).toBe(true);
  });

  it('solution déjà débloquée (persistée)', () => {
    expect(computeLocks(base({ solutionUnlocked: true })).solution.unlocked).toBe(true);
  });

  it('mode examen : tout est verrouillé', () => {
    const l = computeLocks(base({ mode: 'ei_examen', courseRefsAtMs: 0, hintAtMs: 0, activeMs: 9e9 }));
    expect(l.hint.unlocked).toBe(false);
    expect(l.solution.unlocked).toBe(false);
    expect(l.error).toBeNull();
  });
});

describe('signal de présence', () => {
  it('premier signal : rien à ajouter', () => expect(heartbeatDelta(null, 1000, 15_000)).toBe(0));
  it('ajoute le temps écoulé', () => expect(heartbeatDelta(1000, 6000, 15_000)).toBe(5000));
  it('plafonne une longue absence à 15 s', () => expect(heartbeatDelta(0, 600_000, 15_000)).toBe(15_000));
  it('ignore une horloge qui recule', () => expect(heartbeatDelta(5000, 1000, 15_000)).toBe(0));
});
