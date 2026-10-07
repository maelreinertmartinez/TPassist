// Éditeur de structure : corrections manuelles de ce que l'IA a extrait (unités, exercices, questions, sections,
// rattachement des corrigés, fusion de parties). Chaque modification renvoie l'unité complète, à jour.
import { eq } from 'drizzle-orm';
import { isPlayableKind, type EditorUnit, type UnitKind } from '@tpassist/shared';
import { db, newId } from '../db/client';
import { courseUnits, deleteUnits, exercisesWithQuestions, findById, nextOrder, updateSectionFts } from '../db/repo';
import { courseSections, courses, exercises, questions, units } from '../db/schema';
import { HttpError } from '../errors';
import { heuristicLinkCorrections } from '../ingest/corrections';
import { applyCorrigeLink } from '../jobs/linkCorrections';
import { sectionDto, unitDtos } from './courses';
import { clearAiCache } from './tutor';

const unitRow = (id: string) => findById(units, id, 'Partie');

/** Unité complète pour l'éditeur : exercices et questions, sections, et autres unités du cours. 404 si elle n'existe pas. */
export function getEditorUnit(unitId: string): EditorUnit {
  const u = unitRow(unitId);
  const secs = db.select().from(courseSections).where(eq(courseSections.unitId, unitId)).orderBy(courseSections.order).all();
  return {
    unit: unitDtos(u.courseId).find((x) => x.id === unitId)!,
    courseName: findById(courses, u.courseId, 'Cours').name,
    exercises: exercisesWithQuestions(unitId).map(({ ex, questions: qs }) => ({
      id: ex.id,
      order: ex.order,
      title: ex.title,
      contextMd: ex.contextMd,
      questions: qs.map((q) => ({
        id: q.id,
        order: q.order,
        label: q.label,
        statementMd: q.statementMd,
        figurePages: q.figurePages,
        points: q.points,
        officialSolutionMd: q.officialSolutionMd,
      })),
    })),
    sections: secs.map((s) => ({ ...sectionDto(s), contentMd: s.contentMd })),
    siblings: courseUnits(u.courseId)
      .filter((s) => s.id !== unitId)
      .map((s) => ({ id: s.id, kind: s.kind, title: s.title, documentId: s.documentId })),
  };
}

/**
 * Modifie une unité. Le type ne peut changer qu'entre TD, TP et EI (un cours ou un corrigé a une autre structure).
 * @throws HttpError 400 si le titre est vide ou le changement de type impossible
 */
export function updateUnit(unitId: string, patch: { title?: string; kind?: UnitKind; pageStart?: number | null; pageEnd?: number | null; durationMinutes?: number | null }) {
  const u = unitRow(unitId);
  const set: Partial<typeof units.$inferInsert> = {};
  if (patch.title !== undefined) {
    if (!patch.title.trim()) throw new HttpError(400, 'Le titre est obligatoire.');
    set.title = patch.title.trim();
  }
  if (patch.kind && patch.kind !== u.kind) {
    if (!isPlayableKind(patch.kind) || !isPlayableKind(u.kind)) {
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

/** Supprime une unité (chapitre, TD…) et tout ce qui en dépend. */
export function deleteUnit(unitId: string) {
  unitRow(unitId);
  deleteUnits([unitId]);
}

/**
 * Fusionne `sourceId` dans `targetId` : ses exercices, questions et sections sont ajoutés à la fin, puis elle est supprimée.
 * @throws HttpError 400 si les parties ne sont pas du même cours ou pas de même nature
 */
export function mergeUnits(targetId: string, sourceId: string) {
  const t = unitRow(targetId);
  const s = unitRow(sourceId);
  if (t.courseId !== s.courseId) throw new HttpError(400, 'Les deux parties doivent appartenir au même cours.');
  const sameFamily = (t.kind === 'cours') === (s.kind === 'cours') && (t.kind === 'corrige') === (s.kind === 'corrige');
  if (!sameFamily) throw new HttpError(400, 'On ne peut fusionner que des parties de même nature (cours avec cours, exercices avec exercices).');
  if (t.kind === 'corrige') throw new HttpError(400, 'La fusion de corrigés n’est pas prise en charge : réanalyse plutôt le document.');

  // Chaque table garde l'ordre de la source, décalé après les éléments de la cible.
  for (const table of [exercises, questions, courseSections]) {
    const offset = nextOrder(table.order, eq(table.unitId, targetId));
    for (const row of db.select({ id: table.id, order: table.order }).from(table).where(eq(table.unitId, sourceId)).all()) {
      db.update(table).set({ unitId: targetId, order: offset + row.order }).where(eq(table.id, row.id)).run();
    }
  }
  if (t.documentId && t.documentId === s.documentId) {
    db.update(units)
      .set({ pageStart: Math.min(t.pageStart ?? Infinity, s.pageStart ?? Infinity), pageEnd: Math.max(t.pageEnd ?? 0, s.pageEnd ?? 0) })
      .where(eq(units.id, targetId))
      .run();
  }
  db.update(units).set({ correctsUnitId: targetId }).where(eq(units.correctsUnitId, sourceId)).run();
  deleteUnits([sourceId]);
  return getEditorUnit(targetId);
}

/** Modifie un exercice ; changer son énoncé commun invalide les aides générées de ses questions. */
export function updateExercise(id: string, patch: { title?: string; contextMd?: string }) {
  const e = findById(exercises, id, 'Exercice');
  db.update(exercises)
    .set({ title: patch.title?.trim() || e.title, contextMd: patch.contextMd ?? e.contextMd })
    .where(eq(exercises.id, id))
    .run();
  if (patch.contextMd !== undefined && patch.contextMd !== e.contextMd) {
    clearAiCache(db.select({ id: questions.id }).from(questions).where(eq(questions.exerciseId, id)).all().map((q) => q.id));
  }
  return getEditorUnit(e.unitId);
}

/** Supprime un exercice et ses questions. */
export function deleteExercise(id: string) {
  const e = findById(exercises, id, 'Exercice');
  db.delete(exercises).where(eq(exercises.id, id)).run();
  return getEditorUnit(e.unitId);
}

/** Ajoute un exercice (avec une première question) à la fin d'un TD, TP ou EI. */
export function addExercise(unitId: string) {
  const u = unitRow(unitId);
  if (!isPlayableKind(u.kind)) throw new HttpError(400, 'Cette partie ne contient pas d’exercices.');
  const order = nextOrder(exercises.order, eq(exercises.unitId, unitId));
  const exId = newId();
  db.insert(exercises).values({ id: exId, unitId, order, title: `Exercice ${order}`, contextMd: '' }).run();
  addQuestion(exId);
  return getEditorUnit(unitId);
}

/** Ajoute une question à la fin d'un exercice, numérotée à la suite. */
export function addQuestion(exerciseId: string) {
  const e = findById(exercises, exerciseId, 'Exercice');
  const u = unitRow(e.unitId);
  const label = String(db.select({ id: questions.id }).from(questions).where(eq(questions.exerciseId, exerciseId)).all().length + 1);
  db.insert(questions)
    .values({ id: newId(), exerciseId, unitId: e.unitId, documentId: u.documentId, order: nextOrder(questions.order, eq(questions.unitId, e.unitId)), label, statementMd: 'Nouvelle question' })
    .run();
  return getEditorUnit(e.unitId);
}

/**
 * Modifie une question. Changer l'énoncé invalide toutes ses aides générées ; changer le corrigé officiel
 * invalide la solution et l'indice (qui s'en inspirent).
 */
export function updateQuestion(id: string, patch: { label?: string; statementMd?: string; points?: number | null; officialSolutionMd?: string | null; figurePages?: number[] }) {
  const q = findById(questions, id, 'Question');
  const set: Partial<typeof questions.$inferInsert> = {};
  if (patch.label !== undefined) set.label = patch.label.trim() || q.label;
  if (patch.statementMd !== undefined) set.statementMd = patch.statementMd;
  if (patch.points !== undefined) set.points = patch.points;
  if (patch.figurePages !== undefined) set.figurePages = patch.figurePages.filter((n) => Number.isInteger(n) && n > 0);
  if (patch.officialSolutionMd !== undefined) {
    set.officialSolutionMd = patch.officialSolutionMd?.trim() ? patch.officialSolutionMd : null;
    if (!set.officialSolutionMd) {
      set.officialSolutionDocId = null;
      set.officialSolutionPages = null;
    }
  }
  if (Object.keys(set).length) db.update(questions).set(set).where(eq(questions.id, id)).run();
  if (patch.statementMd !== undefined && patch.statementMd !== q.statementMd) {
    clearAiCache([id]);
  } else if (patch.officialSolutionMd !== undefined && (patch.officialSolutionMd ?? null) !== q.officialSolutionMd) {
    clearAiCache([id], ['solution', 'hint']);
  }
  return getEditorUnit(q.unitId);
}

/** Supprime une question. */
export function deleteQuestion(id: string) {
  const q = findById(questions, id, 'Question');
  db.delete(questions).where(eq(questions.id, id)).run();
  return getEditorUnit(q.unitId);
}

/** Modifie une section de cours (et la réindexe pour la recherche). */
export function updateSection(id: string, patch: { title?: string; summary?: string; contentMd?: string }) {
  const s = findById(courseSections, id, 'Section');
  db.update(courseSections)
    .set({ title: patch.title?.trim() || s.title, summary: patch.summary ?? s.summary, contentMd: patch.contentMd ?? s.contentMd })
    .where(eq(courseSections.id, id))
    .run();
  updateSectionFts(id);
  return getEditorUnit(s.unitId);
}

/**
 * Rattachement manuel d'un corrigé à un sujet (ou détachement si `targetUnitId` est null).
 * Sans correspondance fournie, elle est déduite des numéros d'exercices et de questions.
 */
export function linkCorrige(corrigeId: string, targetUnitId: string | null, matches?: { solutionIndex: number; questionId: string }[]) {
  const c = unitRow(corrigeId);
  if (c.kind !== 'corrige') throw new HttpError(400, "Cette partie n'est pas un corrigé.");
  let finalMatches = matches;
  if (targetUnitId && !finalMatches) {
    const target = unitRow(targetUnitId);
    const qs = exercisesWithQuestions(targetUnitId).flatMap(({ ex, questions: list }) => list.map((q) => ({ id: q.id, label: q.label, exerciseTitle: ex.title })));
    const auto = heuristicLinkCorrections(
      [{ id: c.id, title: target.title, targetTitle: target.title, solutions: c.meta.solutions ?? [] }],
      [{ id: target.id, title: target.title, questions: qs }],
    );
    finalMatches = auto.links[0]?.matches ?? [];
  }
  applyCorrigeLink(corrigeId, targetUnitId, finalMatches ?? []);
  return getEditorUnit(corrigeId);
}
