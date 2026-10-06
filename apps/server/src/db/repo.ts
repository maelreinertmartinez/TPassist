import { and, asc, eq, inArray, max, sql } from 'drizzle-orm';
import { db, ftsDeleteSections, ftsUpsertSection, newId } from './client';
import { courseSections, exercises, questions, units } from './schema';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export function notFound(what = 'Ressource'): never {
  throw new HttpError(404, `${what} introuvable`);
}

export function nextUnitOrder(courseId: string): number {
  const r = db.select({ m: max(units.order) }).from(units).where(eq(units.courseId, courseId)).get();
  return (r?.m ?? 0) + 1;
}

/** Supprime des unités et nettoie l'index plein texte de leurs sections. */
export function deleteUnits(unitIds: string[]) {
  if (unitIds.length === 0) return;
  const secs = db.select({ id: courseSections.id }).from(courseSections).where(inArray(courseSections.unitId, unitIds)).all();
  ftsDeleteSections(secs.map((s) => s.id));
  // Les corrigés rattachés à ces unités sont détachés.
  db.update(units).set({ correctsUnitId: null }).where(inArray(units.correctsUnitId, unitIds)).run();
  db.delete(units).where(inArray(units.id, unitIds)).run();
}

export function insertSection(input: {
  unitId: string;
  courseId: string;
  order: number;
  title: string;
  pageStart: number | null;
  pageEnd: number | null;
  summary: string;
  keyConcepts: string[];
  contentMd: string;
}) {
  const row = db
    .insert(courseSections)
    .values({ id: newId(), ...input })
    .returning()
    .get();
  ftsUpsertSection(row);
  return row;
}

export function updateSectionFts(sectionId: string) {
  const row = db.select().from(courseSections).where(eq(courseSections.id, sectionId)).get();
  if (row) ftsUpsertSection(row);
}

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

export function insertExercises(unitId: string, documentId: string | null, list: NewExercise[], startOrder = 0) {
  const created: { exerciseId: string; questionIds: string[] }[] = [];
  let qOrder = (db.select({ m: max(questions.order) }).from(questions).where(eq(questions.unitId, unitId)).get()?.m ?? 0) + 1;
  list.forEach((ex, i) => {
    const exRow = db
      .insert(exercises)
      .values({ id: newId(), unitId, order: startOrder + i, title: ex.title, contextMd: ex.contextMd })
      .returning()
      .get();
    const qIds: string[] = [];
    for (const q of ex.questions) {
      const id = newId();
      db.insert(questions)
        .values({
          id,
          exerciseId: exRow.id,
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
      qIds.push(id);
    }
    created.push({ exerciseId: exRow.id, questionIds: qIds });
  });
  return created;
}

/** Questions d'une unité dans l'ordre (exercice puis question). */
export function orderedQuestions(unitId: string) {
  return db
    .select({ q: questions, ex: exercises })
    .from(questions)
    .innerJoin(exercises, eq(exercises.id, questions.exerciseId))
    .where(eq(questions.unitId, unitId))
    .orderBy(asc(exercises.order), asc(questions.order))
    .all();
}

export function questionWithContext(questionId: string) {
  const row = db
    .select({ q: questions, ex: exercises, unit: units })
    .from(questions)
    .innerJoin(exercises, eq(exercises.id, questions.exerciseId))
    .innerJoin(units, eq(units.id, questions.unitId))
    .where(eq(questions.id, questionId))
    .get();
  if (!row) notFound('Question');
  return row;
}

export type QuestionContext = ReturnType<typeof questionWithContext>;

export function countBy<T extends string>(values: T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

export const nowMs = () => Date.now();

export { and, eq, sql };
