// Requêtes de données réutilisées par plusieurs services et tâches (aucune règle métier ici).
import { and, asc, count, eq, inArray, max, ne, type InferSelectModel, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { UnitKind } from '@tpassist/shared';
import { notFound } from '../errors';
import { db, ftsDeleteSections, ftsUpsertSection, newId } from './client';
import { courseSections, exercises, questions, units } from './schema';

type TableWithId = SQLiteTable & { id: SQLiteColumn };

/** Ligne d'une table par son id ; lève une 404 « <label> introuvable » si elle n'existe pas. */
export function findById<T extends TableWithId>(table: T, id: string, label: string): InferSelectModel<T> {
  const row = db
    .select()
    .from(table as SQLiteTable)
    .where(eq(table.id, id))
    .get() as InferSelectModel<T> | undefined;
  return row ?? notFound(label);
}

/** Nombre de lignes d'une table vérifiant `where`. */
export function countWhere(table: SQLiteTable, where?: SQL): number {
  return db.select({ n: count() }).from(table).where(where).get()?.n ?? 0;
}

/** Prochaine valeur d'une colonne d'ordre (max + 1, ou 1 si aucune ligne). */
export function nextOrder(column: SQLiteColumn, where: SQL): number {
  const r = db.select({ m: max(column) }).from(column.table).where(where).get();
  return Number(r?.m ?? 0) + 1;
}

/** Unités d'un cours dans l'ordre, éventuellement limitées à certains types. */
export function courseUnits(courseId: string, kinds?: readonly UnitKind[]) {
  return db
    .select()
    .from(units)
    .where(and(eq(units.courseId, courseId), kinds ? inArray(units.kind, [...kinds]) : undefined))
    .orderBy(asc(units.order))
    .all();
}

/**
 * Ids des unités extraites d'un document.
 * @param opts.keepManual exclut les parties ajoutées à la main (une réanalyse les garde)
 */
export function documentUnitIds(documentId: string, opts: { keepManual?: boolean } = {}): string[] {
  return db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.documentId, documentId), opts.keepManual ? ne(units.origin, 'manual') : undefined))
    .all()
    .map((u) => u.id);
}

/** Supprime des unités (et tout ce qui en dépend) et nettoie l'index plein texte de leurs sections. */
export function deleteUnits(unitIds: string[]) {
  if (unitIds.length === 0) return;
  const secs = db.select({ id: courseSections.id }).from(courseSections).where(inArray(courseSections.unitId, unitIds)).all();
  ftsDeleteSections(secs.map((s) => s.id));
  // Les corrigés rattachés à ces unités sont détachés.
  db.update(units).set({ correctsUnitId: null }).where(inArray(units.correctsUnitId, unitIds)).run();
  db.delete(units).where(inArray(units.id, unitIds)).run();
}

/** Crée une section de cours et l'indexe pour la recherche plein texte. */
export function insertSection(input: Omit<typeof courseSections.$inferInsert, 'id'> & { keyConcepts: string[] }) {
  const row = db
    .insert(courseSections)
    .values({ id: newId(), ...input })
    .returning()
    .get();
  ftsUpsertSection(row);
  return row;
}

/** Réindexe une section après modification. */
export function updateSectionFts(sectionId: string) {
  const row = db.select().from(courseSections).where(eq(courseSections.id, sectionId)).get();
  if (row) ftsUpsertSection(row);
}

/** Exercice à créer, avec ses questions (issu d'une extraction ou d'une génération). */
export interface NewExercise {
  title: string;
  contextMd: string;
  questions: {
    label: string;
    statementMd: string;
    figurePages: number[];
    dependsOnPrevious: boolean;
    points: number | null;
    officialSolutionMd?: string | null;
    weakPointId?: string | null;
  }[];
}

/**
 * Ajoute des exercices et leurs questions à la fin d'une unité.
 * @returns les ids créés, dans l'ordre de `list`
 */
export function insertExercises(unitId: string, documentId: string | null, list: NewExercise[], startOrder = 0) {
  let qOrder = nextOrder(questions.order, eq(questions.unitId, unitId));
  return list.map((ex, i) => {
    const exerciseId = newId();
    db.insert(exercises).values({ id: exerciseId, unitId, order: startOrder + i, title: ex.title, contextMd: ex.contextMd }).run();
    const questionIds = ex.questions.map((q) => {
      const id = newId();
      db.insert(questions)
        .values({
          id,
          exerciseId,
          unitId,
          documentId,
          order: qOrder++,
          label: q.label,
          statementMd: q.statementMd,
          figurePages: q.figurePages,
          dependsOnPrevious: q.dependsOnPrevious,
          points: q.points,
          officialSolutionMd: q.officialSolutionMd ?? null,
          officialSolutionDocId: q.officialSolutionMd ? documentId : null,
          weakPointId: q.weakPointId ?? null,
        })
        .run();
      return id;
    });
    return { exerciseId, questionIds };
  });
}

/** Questions d'une unité dans l'ordre (exercice puis question), avec leur exercice. */
export function orderedQuestions(unitId: string) {
  return db
    .select({ q: questions, ex: exercises })
    .from(questions)
    .innerJoin(exercises, eq(exercises.id, questions.exerciseId))
    .where(eq(questions.unitId, unitId))
    .orderBy(asc(exercises.order), asc(questions.order))
    .all();
}

/** Exercices d'une unité dans l'ordre, chacun avec ses questions (y compris les exercices encore vides). */
export function exercisesWithQuestions(unitId: string) {
  const exs = db.select().from(exercises).where(eq(exercises.unitId, unitId)).orderBy(asc(exercises.order)).all();
  const qs = db.select().from(questions).where(eq(questions.unitId, unitId)).orderBy(asc(questions.order)).all();
  return exs.map((ex) => ({ ex, questions: qs.filter((q) => q.exerciseId === ex.id) }));
}

/** Une question avec son exercice et son unité ; 404 si elle n'existe pas. */
export function questionWithContext(questionId: string) {
  const row = db
    .select({ q: questions, ex: exercises, unit: units })
    .from(questions)
    .innerJoin(exercises, eq(exercises.id, questions.exerciseId))
    .innerJoin(units, eq(units.id, questions.unitId))
    .where(eq(questions.id, questionId))
    .get();
  return row ?? notFound('Question');
}

/** Question avec son exercice et son unité. */
export type QuestionContext = ReturnType<typeof questionWithContext>;
