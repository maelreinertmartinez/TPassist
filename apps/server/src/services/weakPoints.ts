import { and, desc, eq, inArray } from 'drizzle-orm';
import type { WeakPointDto, WeakPointStatus } from '@tpassist/shared';
import { db, newId } from '../db/client';
import { courseSections, questions, units, weakPointEvents, weakPoints } from '../db/schema';

export type Outcome = 'success' | 'failure' | 'reported';

export interface WeakPointState {
  priority: number;
  status: WeakPointStatus;
  successStreak: number;
}

export const NEW_POINT_PRIORITY = 50;
const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Applique un résultat (réussite, échec, difficulté rapportée par un bilan). */
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

export function recordOutcome(weakPointId: string, outcome: Outcome, source: string, note?: string) {
  const wp = db.select().from(weakPoints).where(eq(weakPoints.id, weakPointId)).get();
  if (!wp) return;
  const next = applyOutcome(wp, outcome);
  db.update(weakPoints)
    .set({ priority: next.priority, status: next.status, successStreak: next.successStreak, updatedAt: Date.now() })
    .where(eq(weakPoints.id, weakPointId))
    .run();
  db.insert(weakPointEvents)
    .values({ id: newId(), weakPointId, source, delta: next.delta, note: note ?? outcome })
    .run();
}

/** Enregistre une difficulté issue d'un bilan : renforce un point existant ou en crée un. */
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
  db.insert(weakPointEvents).values({ id: newId(), weakPointId: id, source, delta: NEW_POINT_PRIORITY, note: 'créé' }).run();
  return id;
}

export function activeWeakPoints(courseId: string) {
  return db
    .select()
    .from(weakPoints)
    .where(and(eq(weakPoints.courseId, courseId), eq(weakPoints.status, 'active')))
    .orderBy(desc(weakPoints.priority))
    .all();
}

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

export function setWeakPointStatus(id: string, status: WeakPointStatus) {
  const patch: Partial<typeof weakPoints.$inferInsert> = { status, updatedAt: Date.now() };
  if (status === 'active') patch.successStreak = 0;
  db.update(weakPoints).set(patch).where(eq(weakPoints.id, id)).run();
  db.insert(weakPointEvents).values({ id: newId(), weakPointId: id, source: 'manuel', delta: 0, note: status }).run();
}

/** Texte compact des points bloquants actifs pour les prompts de génération. */
export function weakPointsForPrompt(courseId: string, limit = 12) {
  return activeWeakPoints(courseId)
    .slice(0, limit)
    .map((w) => ({ id: w.id, notion: w.notion, description: w.descriptionMd, priority: w.priority, sectionIds: w.sectionIds }));
}
