// Points bloquants d'un cours : création depuis les bilans, évolution selon les réussites et échecs,
// gestion manuelle, et part réservée dans les quiz et EI générés.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { WeakPointDto, WeakPointStatus } from '@tpassist/shared';
import { db, newId } from '../db/client';
import { courseSections, questions, units, weakPointEvents, weakPoints } from '../db/schema';

/** Résultat observé sur une notion : réussite, échec, ou difficulté relevée par un bilan. */
export type Outcome = 'success' | 'failure' | 'reported';

/** Ce qui évolue sur un point bloquant à chaque résultat. */
export interface WeakPointState {
  priority: number;
  status: WeakPointStatus;
  successStreak: number;
}

/** Part des questions de quiz et du barème des EI générées consacrée aux points bloquants. */
export const WEAK_POINT_SHARE = 0.6;

const NEW_POINT_PRIORITY = 50;
const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Nouvel état d'un point bloquant après un résultat (fonction pure).
 * Une réussite baisse la priorité ; deux réussites d'affilée le font passer à « maîtrisé ».
 * Un échec ou une difficulté rapportée le réactive et augmente sa priorité.
 */
export function applyOutcome(s: WeakPointState, outcome: Outcome): WeakPointState & { delta: number } {
  if (outcome === 'success') {
    const priority = clamp(s.priority - 15);
    const successStreak = s.successStreak + 1;
    const status: WeakPointStatus = s.status === 'active' && successStreak >= 2 ? 'mastered' : s.status;
    return { priority, successStreak, status, delta: priority - s.priority };
  }
  const bump = outcome === 'failure' ? 20 : 25;
  const priority = clamp(s.priority + bump);
  return { priority, successStreak: 0, status: 'active', delta: priority - s.priority };
}

/** Enregistre un résultat sur un point bloquant (et l'historise). Sans effet si le point n'existe plus. */
export function recordOutcome(weakPointId: string, outcome: Outcome, source: string, note?: string) {
  const wp = db.select().from(weakPoints).where(eq(weakPoints.id, weakPointId)).get();
  if (!wp) return;
  const next = applyOutcome(wp, outcome);
  db.update(weakPoints)
    .set({ priority: next.priority, status: next.status, successStreak: next.successStreak, updatedAt: Date.now() })
    .where(eq(weakPoints.id, weakPointId))
    .run();
  logEvent(weakPointId, source, next.delta, note ?? outcome);
}

/**
 * Enregistre une difficulté issue d'un bilan : renforce un point existant ou en crée un.
 * @returns l'id du point bloquant concerné
 */
export function reportDifficulty(
  courseId: string,
  input: { existingWeakPointId: string | null; notion: string; descriptionMd: string; sectionIds: string[]; questionIds: string[] },
  source: string,
): string {
  const existing = input.existingWeakPointId
    ? db
        .select()
        .from(weakPoints)
        .where(and(eq(weakPoints.id, input.existingWeakPointId), eq(weakPoints.courseId, courseId)))
        .get()
    : undefined;
  if (existing) {
    recordOutcome(existing.id, 'reported', source, input.notion);
    db.update(weakPoints)
      .set({
        sectionIds: [...new Set([...existing.sectionIds, ...input.sectionIds])],
        sourceQuestionIds: [...new Set([...existing.sourceQuestionIds, ...input.questionIds])],
        descriptionMd: input.descriptionMd || existing.descriptionMd,
      })
      .where(eq(weakPoints.id, existing.id))
      .run();
    return existing.id;
  }
  const id = newId();
  db.insert(weakPoints)
    .values({
      id,
      courseId,
      notion: input.notion,
      descriptionMd: input.descriptionMd,
      sectionIds: input.sectionIds,
      sourceQuestionIds: input.questionIds,
      priority: NEW_POINT_PRIORITY,
      status: 'active',
    })
    .run();
  logEvent(id, source, NEW_POINT_PRIORITY, 'créé');
  return id;
}

/** Points bloquants actifs d'un cours, du plus prioritaire au moins prioritaire. */
export function activeWeakPoints(courseId: string) {
  return db
    .select()
    .from(weakPoints)
    .where(and(eq(weakPoints.courseId, courseId), eq(weakPoints.status, 'active')))
    .orderBy(desc(weakPoints.priority))
    .all();
}

/** Points bloquants d'un cours pour le front : actifs d'abord, puis maîtrisés, puis écartés. */
export function listWeakPoints(courseId: string): WeakPointDto[] {
  const rows = db.select().from(weakPoints).where(eq(weakPoints.courseId, courseId)).orderBy(desc(weakPoints.priority)).all();
  const sectionIds = [...new Set(rows.flatMap((r) => r.sectionIds))];
  const questionIds = [...new Set(rows.flatMap((r) => r.sourceQuestionIds))];
  const secs = sectionIds.length
    ? db.select({ id: courseSections.id, title: courseSections.title }).from(courseSections).where(inArray(courseSections.id, sectionIds)).all()
    : [];
  const qs = questionIds.length
    ? db
        .select({ id: questions.id, label: questions.label, unitTitle: units.title })
        .from(questions)
        .innerJoin(units, eq(units.id, questions.unitId))
        .where(inArray(questions.id, questionIds))
        .all()
    : [];
  const statusOrder: Record<WeakPointStatus, number> = { active: 0, mastered: 1, resolved: 2 };
  return rows
    .map((r) => ({
      id: r.id,
      notion: r.notion,
      descriptionMd: r.descriptionMd,
      priority: r.priority,
      status: r.status,
      successStreak: r.successStreak,
      sections: secs.filter((s) => r.sectionIds.includes(s.id)),
      sourceQuestions: qs.filter((q) => r.sourceQuestionIds.includes(q.id)),
      updatedAt: r.updatedAt,
    }))
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || b.priority - a.priority);
}

/** Change le statut d'un point bloquant à la main (le réactiver remet sa série de réussites à zéro). */
export function setWeakPointStatus(id: string, status: WeakPointStatus) {
  const patch: Partial<typeof weakPoints.$inferInsert> = { status, updatedAt: Date.now() };
  if (status === 'active') patch.successStreak = 0;
  db.update(weakPoints).set(patch).where(eq(weakPoints.id, id)).run();
  logEvent(id, 'manuel', 0, status);
}

/** Supprime un point bloquant et son historique. */
export function deleteWeakPoint(id: string) {
  db.delete(weakPoints).where(eq(weakPoints.id, id)).run();
}

/** Points bloquants actifs sous forme compacte, pour les prompts de génération. */
export function weakPointsForPrompt(courseId: string, limit = 12) {
  return activeWeakPoints(courseId)
    .slice(0, limit)
    .map((w) => ({ id: w.id, notion: w.notion, description: w.descriptionMd, priority: w.priority, sectionIds: w.sectionIds }));
}

/**
 * Répartit `n` items (questions ou points de barème) entre les points bloquants, au prorata de leur priorité.
 * @returns nombre d'items par id de point bloquant (les points sans item sont omis)
 */
export function allocateWeakPointItems(points: { id: string; priority: number }[], n: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (n <= 0 || points.length === 0) return out;
  const total = points.reduce((a, p) => a + Math.max(1, p.priority), 0);
  const shares = points.map((p) => ({ id: p.id, exact: (n * Math.max(1, p.priority)) / total }));
  let assigned = 0;
  for (const s of shares) {
    out[s.id] = Math.floor(s.exact);
    assigned += out[s.id];
  }
  // Le reste va aux plus grandes parties fractionnaires.
  shares.sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)));
  for (let i = 0; assigned < n; i = (i + 1) % shares.length) {
    out[shares[i].id]++;
    assigned++;
  }
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k];
  return out;
}

function logEvent(weakPointId: string, source: string, delta: number, note: string) {
  db.insert(weakPointEvents).values({ id: newId(), weakPointId, source, delta, note }).run();
}
