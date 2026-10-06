import { and, asc, eq, inArray, max } from 'drizzle-orm';
import type { EditorUnit, UnitKind } from '@tpassist/shared';
import { db, newId } from '../db/client';
import { deleteUnits, HttpError, notFound, updateSectionFts } from '../db/repo';
import { courseSections, exercises, questionAiCache, questions, units } from '../db/schema';
import { heuristicLinkCorrections } from '../ingest/corrections';
import { applyCorrigeLink } from '../jobs/linkCorrections';
import { unitDtos } from './courses';

function unitRow(id: string) {
  return db.select().from(units).where(eq(units.id, id)).get() ?? notFound('Partie');
}

export function getEditorUnit(unitId: string): EditorUnit {
  const u = unitRow(unitId);
  const dto = unitDtos(u.courseId).find((x) => x.id === unitId)!;
  const exs = db.select().from(exercises).where(eq(exercises.unitId, unitId)).orderBy(asc(exercises.order)).all();
  const qs = db.select().from(questions).where(eq(questions.unitId, unitId)).orderBy(asc(questions.order)).all();
  const secs = db.select().from(courseSections).where(eq(courseSections.unitId, unitId)).orderBy(asc(courseSections.order)).all();
  const siblings = db
    .select({ id: units.id, kind: units.kind, title: units.title, documentId: units.documentId })
    .from(units)
    .where(eq(units.courseId, u.courseId))
    .orderBy(asc(units.order))
    .all()
    .filter((s) => s.id !== unitId);
  return {
    unit: dto,
    exercises: exs.map((e) => ({
      id: e.id,
      order: e.order,
      title: e.title,
      contextMd: e.contextMd,
      questions: qs
        .filter((q) => q.exerciseId === e.id)
        .map((q) => ({
          id: q.id,
          order: q.order,
          label: q.label,
          statementMd: q.statementMd,
          figurePages: q.figurePages,
          points: q.points,
          dependsOnPrevious: q.dependsOnPrevious,
          officialSolutionMd: q.officialSolutionMd,
        })),
    })),
    sections: secs.map((s) => ({
      id: s.id,
      unitId: s.unitId,
      title: s.title,
      pageStart: s.pageStart,
      pageEnd: s.pageEnd,
      summary: s.summary,
      keyConcepts: s.keyConcepts,
      contentMd: s.contentMd,
    })),
    siblings,
  };
}

const EXERCISE_KINDS: UnitKind[] = ['td', 'tp', 'ei'];

export function updateUnit(unitId: string, patch: { title?: string; kind?: UnitKind; pageStart?: number | null; pageEnd?: number | null; durationMinutes?: number | null }) {
  const u = unitRow(unitId);
  const set: Partial<typeof units.$inferInsert> = {};
  if (patch.title !== undefined) {
    if (!patch.title.trim()) throw new HttpError(400, 'Le titre est obligatoire.');
    set.title = patch.title.trim();
  }
  if (patch.kind && patch.kind !== u.kind) {
    if (!(EXERCISE_KINDS.includes(patch.kind) && EXERCISE_KINDS.includes(u.kind))) {
      throw new HttpError(400, 'On ne peut changer le type qu’entre TD, TP et EI. Pour un cours ou un corrigé, réanalyse le document.');
    }
    set.kind = patch.kind;
  }
  if (patch.pageStart !== undefined) set.pageStart = patch.pageStart;
  if (patch.pageEnd !== undefined) set.pageEnd = patch.pageEnd;
  if (patch.durationMinutes !== undefined) set.meta = { ...u.meta, durationMinutes: patch.durationMinutes };
  if (Object.keys(set).length) db.update(units).set(set).where(eq(units.id, unitId)).run();
  return getEditorUnit(unitId);
}

export function deleteUnit(unitId: string) {
  unitRow(unitId);
  deleteUnits([unitId]);
}

/** Fusionne `sourceId` dans `targetId` (exercices ou sections ajoutés à la fin). */
export function mergeUnits(targetId: string, sourceId: string) {
  const t = unitRow(targetId);
  const s = unitRow(sourceId);
  if (t.courseId !== s.courseId) throw new HttpError(400, 'Les deux parties doivent appartenir au même cours.');
  const sameFamily = (t.kind === 'cours') === (s.kind === 'cours') && (t.kind === 'corrige') === (s.kind === 'corrige');
  if (!sameFamily) throw new HttpError(400, 'On ne peut fusionner que des parties de même nature (cours avec cours, exercices avec exercices).');
  if (t.kind === 'corrige') throw new HttpError(400, 'La fusion de corrigés n’est pas prise en charge : réanalyse plutôt le document.');

  const exOffset = (db.select({ m: max(exercises.order) }).from(exercises).where(eq(exercises.unitId, targetId)).get()?.m ?? 0) + 1;
  const qOffset = (db.select({ m: max(questions.order) }).from(questions).where(eq(questions.unitId, targetId)).get()?.m ?? 0) + 1;
  const secOffset = (db.select({ m: max(courseSections.order) }).from(courseSections).where(eq(courseSections.unitId, targetId)).get()?.m ?? 0) + 1;

  for (const e of db.select().from(exercises).where(eq(exercises.unitId, sourceId)).all()) {
    db.update(exercises).set({ unitId: targetId, order: exOffset + e.order }).where(eq(exercises.id, e.id)).run();
  }
  for (const q of db.select().from(questions).where(eq(questions.unitId, sourceId)).all()) {
    db.update(questions).set({ unitId: targetId, order: qOffset + q.order }).where(eq(questions.id, q.id)).run();
  }
  for (const sec of db.select().from(courseSections).where(eq(courseSections.unitId, sourceId)).all()) {
    db.update(courseSections).set({ unitId: targetId, order: secOffset + sec.order }).where(eq(courseSections.id, sec.id)).run();
  }
  if (t.documentId && t.documentId === s.documentId) {
    db.update(units)
      .set({
        pageStart: Math.min(t.pageStart ?? Infinity, s.pageStart ?? Infinity),
        pageEnd: Math.max(t.pageEnd ?? 0, s.pageEnd ?? 0),
      })
      .where(eq(units.id, targetId))
      .run();
  }
  db.update(units).set({ correctsUnitId: targetId }).where(eq(units.correctsUnitId, sourceId)).run();
  deleteUnits([sourceId]);
  return getEditorUnit(targetId);
}

export function updateExercise(id: string, patch: { title?: string; contextMd?: string }) {
  const e = db.select().from(exercises).where(eq(exercises.id, id)).get() ?? notFound('Exercice');
  db.update(exercises)
    .set({ title: patch.title?.trim() || e.title, contextMd: patch.contextMd ?? e.contextMd })
    .where(eq(exercises.id, id))
    .run();
  if (patch.contextMd !== undefined && patch.contextMd !== e.contextMd) {
    const qIds = db.select({ id: questions.id }).from(questions).where(eq(questions.exerciseId, id)).all().map((q) => q.id);
    if (qIds.length) db.delete(questionAiCache).where(inArray(questionAiCache.questionId, qIds)).run();
  }
  return getEditorUnit(e.unitId);
}

export function deleteExercise(id: string) {
  const e = db.select().from(exercises).where(eq(exercises.id, id)).get() ?? notFound('Exercice');
  db.delete(exercises).where(eq(exercises.id, id)).run();
  return getEditorUnit(e.unitId);
}

export function addExercise(unitId: string) {
  const u = unitRow(unitId);
  if (!EXERCISE_KINDS.includes(u.kind)) throw new HttpError(400, 'Cette partie ne contient pas d’exercices.');
  const order = (db.select({ m: max(exercises.order) }).from(exercises).where(eq(exercises.unitId, unitId)).get()?.m ?? 0) + 1;
  const exId = newId();
  db.insert(exercises).values({ id: exId, unitId, order, title: `Exercice ${order}`, contextMd: '' }).run();
  addQuestion(exId);
  return getEditorUnit(unitId);
}

export function addQuestion(exerciseId: string) {
  const e = db.select().from(exercises).where(eq(exercises.id, exerciseId)).get() ?? notFound('Exercice');
  const u = unitRow(e.unitId);
  const order = (db.select({ m: max(questions.order) }).from(questions).where(eq(questions.unitId, e.unitId)).get()?.m ?? 0) + 1;
  const n = db.select({ id: questions.id }).from(questions).where(eq(questions.exerciseId, exerciseId)).all().length + 1;
  db.insert(questions)
    .values({ id: newId(), exerciseId, unitId: e.unitId, documentId: u.documentId, order, label: String(n), statementMd: 'Nouvelle question' })
    .run();
  return getEditorUnit(e.unitId);
}

export function updateQuestion(
  id: string,
  patch: { label?: string; statementMd?: string; points?: number | null; officialSolutionMd?: string | null; dependsOnPrevious?: boolean; figurePages?: number[] },
) {
  const q = db.select().from(questions).where(eq(questions.id, id)).get() ?? notFound('Question');
  const set: Partial<typeof questions.$inferInsert> = {};
  if (patch.label !== undefined) set.label = patch.label.trim() || q.label;
  if (patch.statementMd !== undefined) set.statementMd = patch.statementMd;
  if (patch.points !== undefined) set.points = patch.points;
  if (patch.dependsOnPrevious !== undefined) set.dependsOnPrevious = patch.dependsOnPrevious;
  if (patch.figurePages !== undefined) set.figurePages = patch.figurePages.filter((n) => Number.isInteger(n) && n > 0);
  if (patch.officialSolutionMd !== undefined) {
    set.officialSolutionMd = patch.officialSolutionMd?.trim() ? patch.officialSolutionMd : null;
    if (!set.officialSolutionMd) {
      set.officialSolutionDocId = null;
      set.officialSolutionPages = null;
    }
  }
  if (Object.keys(set).length) db.update(questions).set(set).where(eq(questions.id, id)).run();
  // Le contenu a changé : les aides générées ne sont plus valables.
  if (patch.statementMd !== undefined && patch.statementMd !== q.statementMd) {
    db.delete(questionAiCache).where(eq(questionAiCache.questionId, id)).run();
  } else if (patch.officialSolutionMd !== undefined && (patch.officialSolutionMd ?? null) !== q.officialSolutionMd) {
    db.delete(questionAiCache)
      .where(and(eq(questionAiCache.questionId, id), inArray(questionAiCache.kind, ['solution', 'hint'])))
      .run();
  }
  return getEditorUnit(q.unitId);
}

export function deleteQuestion(id: string) {
  const q = db.select().from(questions).where(eq(questions.id, id)).get() ?? notFound('Question');
  db.delete(questions).where(eq(questions.id, id)).run();
  return getEditorUnit(q.unitId);
}

export function updateSection(id: string, patch: { title?: string; summary?: string; contentMd?: string }) {
  const s = db.select().from(courseSections).where(eq(courseSections.id, id)).get() ?? notFound('Section');
  db.update(courseSections)
    .set({ title: patch.title?.trim() || s.title, summary: patch.summary ?? s.summary, contentMd: patch.contentMd ?? s.contentMd })
    .where(eq(courseSections.id, id))
    .run();
  updateSectionFts(id);
  return getEditorUnit(s.unitId);
}

/** Rattachement manuel d'un corrigé. Sans correspondance fournie, on la déduit des numéros de questions. */
export function linkCorrige(corrigeId: string, targetUnitId: string | null, matches?: { solutionIndex: number; questionId: string }[]) {
  const c = unitRow(corrigeId);
  if (c.kind !== 'corrige') throw new HttpError(400, "Cette partie n'est pas un corrigé.");
  let finalMatches = matches;
  if (targetUnitId && !finalMatches) {
    const target = unitRow(targetUnitId);
    const qs = db
      .select({ id: questions.id, label: questions.label, exerciseTitle: exercises.title })
      .from(questions)
      .innerJoin(exercises, eq(exercises.id, questions.exerciseId))
      .where(eq(questions.unitId, targetUnitId))
      .all();
    const auto = heuristicLinkCorrections(
      [{ id: c.id, title: target.title, targetTitle: target.title, solutions: c.meta.solutions ?? [] }],
      [{ id: target.id, title: target.title, questions: qs }],
    );
    finalMatches = auto.links[0]?.matches ?? [];
  }
  applyCorrigeLink(corrigeId, targetUnitId, finalMatches ?? []);
  return getEditorUnit(corrigeId);
}
