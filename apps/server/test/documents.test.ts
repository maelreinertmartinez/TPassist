import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.TPASSIST_AI_MOCK = '1';
  // Dossier de données jetable : les images des pages y sont écrites.
  process.env.DATA_DIR = `${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/tpassist-documents-test-${process.pid}`;
});

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import type { AddUnitFromPagesBody } from '@tpassist/shared';
import { config, ensureDataDirs } from '../src/config';
import { db, newId, openDb } from '../src/db/client';
import { documentUnitIds, insertExercises, orderedQuestions } from '../src/db/repo';
import { courses, documents, jobs, units } from '../src/db/schema';
import { extractUnit } from '../src/jobs/extractUnit';
import type { JobRow } from '../src/jobs/queue';
import { pageImagePath } from '../src/pdf/render';
import { addUnitFromPages, documentSessionsCount } from '../src/services/documents';
import { createSession } from '../src/services/sessions';

const PAGES = [
  'Chapitre 1 - Matrices\nDéfinition : une matrice est un tableau de nombres.',
  'TD 1 - Calcul matriciel\nExercice 1 - Produit\nSoit A une matrice.\n1) Calculer AB.\n2) Calculer BA.',
  'Exercice 2\n1) Calculer det(A).',
  'Corrigé du TD 1 - Calcul matriciel\nExercice 1\n1) AB = I.\n2) BA = I.',
];

/** Cours avec un document de 4 pages ; les images des pages sont de faux fichiers (poppler n'est pas nécessaire). */
function seed(status: 'ready' | 'processing' = 'ready') {
  const courseId = newId();
  const documentId = newId();
  db.insert(courses).values({ id: courseId, name: 'Algèbre' }).run();
  db.insert(documents)
    .values({ id: documentId, courseId, filename: 'algebre.pdf', path: '/inexistant.pdf', status, pageCount: PAGES.length, pagesText: PAGES })
    .run();
  mkdirSync(`${config.pagesDir}/${documentId}`, { recursive: true });
  PAGES.forEach((_, i) => writeFileSync(pageImagePath(documentId, i + 1, 'full'), 'png'));
  return { courseId, documentId };
}

/** Exécute la tâche d'ajout manuel comme le ferait la file. */
const run = (documentId: string, payload: AddUnitFromPagesBody) =>
  extractUnit({ refId: documentId, payload: { ...payload } } as unknown as JobRow, { progress: () => {} });

beforeAll(() => ensureDataDirs());
afterAll(() => rmSync(config.dataDir, { recursive: true, force: true }));
beforeEach(() => {
  openDb(':memory:');
  // Les tâches mises en file ne doivent pas démarrer pendant les tests.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('ajout manuel d’une partie : validation de la demande', () => {
  const body: AddUnitFromPagesBody = { kind: 'td', title: 'TD 1', pageStart: 2, pageEnd: 3 };

  it('met en file une tâche extract_unit pour le document', () => {
    const { courseId, documentId } = seed();
    const job = addUnitFromPages(documentId, { ...body, title: '  TD 1  ' });
    expect(job).toMatchObject({ type: 'extract_unit', status: 'queued', refId: documentId });
    const row = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(row.courseId).toBe(courseId);
    expect(row.payload).toEqual(body);
  });

  it('refuse un document pas encore analysé', () => {
    const { documentId } = seed('processing');
    expect(() => addUnitFromPages(documentId, body)).toThrow(/fin de l’analyse/);
  });

  it('refuse un type inconnu, un titre vide ou des pages invalides', () => {
    const { documentId } = seed();
    expect(() => addUnitFromPages(documentId, { ...body, kind: 'examen' as never })).toThrow(/Type de partie/);
    expect(() => addUnitFromPages(documentId, { ...body, title: '   ' })).toThrow(/titre/);
    for (const pages of [
      { pageStart: 0, pageEnd: 2 },
      { pageStart: 2, pageEnd: 5 },
      { pageStart: 3, pageEnd: 2 },
      { pageStart: 1.5, pageEnd: 2 },
    ]) {
      expect(() => addUnitFromPages(documentId, { ...body, ...pages })).toThrow(/Pages invalides/);
    }
    expect(db.select().from(jobs).all()).toHaveLength(0);
  });

  it('refuse un document inexistant', () => {
    expect(() => addUnitFromPages('inconnu', body)).toThrow(/introuvable/);
  });
});

describe('ajout manuel d’une partie : extraction', () => {
  it('crée un TD « ajouté à la main » avec ses exercices et ses questions', async () => {
    const { courseId, documentId } = seed();
    await run(documentId, { kind: 'td', title: 'TD 1', pageStart: 2, pageEnd: 3 });
    const [unit] = db.select().from(units).where(eq(units.courseId, courseId)).all();
    expect(unit).toMatchObject({ kind: 'td', title: 'TD 1', origin: 'manual', documentId, pageStart: 2, pageEnd: 3 });
    expect(orderedQuestions(unit.id).map(({ ex, q }) => [ex.title, q.label])).toEqual([
      ['Exercice 1 – Produit', '1'],
      ['Exercice 1 – Produit', '2'],
      ['Exercice 2', '1'],
    ]);
  });

  it('crée un chapitre de cours avec ses sections', async () => {
    const { courseId, documentId } = seed();
    await run(documentId, { kind: 'cours', title: 'Chapitre 1', pageStart: 1, pageEnd: 1 });
    const unit = db.select().from(units).where(eq(units.courseId, courseId)).get()!;
    expect(unit).toMatchObject({ kind: 'cours', origin: 'manual' });
  });

  it('ajoute un corrigé à la fin du cours puis demande son rattachement', async () => {
    const { courseId, documentId } = seed();
    await run(documentId, { kind: 'td', title: 'TD 1', pageStart: 2, pageEnd: 3 });
    await run(documentId, { kind: 'corrige', title: 'Corrigé du TD 1', pageStart: 4, pageEnd: 4 });
    const corrige = db.select().from(units).where(eq(units.kind, 'corrige')).get()!;
    expect(corrige.order).toBe(2);
    expect(corrige.meta.solutions?.map((s) => s.questionLabel)).toEqual(['1', '2']);
    expect(db.select().from(jobs).where(eq(jobs.courseId, courseId)).all().map((j) => j.type)).toEqual(['link_corrections']);
  });

  it('ne fait rien si le document a été supprimé entre-temps', async () => {
    await run('inconnu', { kind: 'td', title: 'TD', pageStart: 1, pageEnd: 1 });
    expect(db.select().from(units).all()).toHaveLength(0);
  });
});

describe('réanalyse d’un document', () => {
  it('garde les parties ajoutées à la main et leurs séances', () => {
    const { courseId, documentId } = seed();
    const detected = newId();
    const manual = newId();
    db.insert(units)
      .values([
        { id: detected, courseId, documentId, kind: 'td', title: 'TD détecté', origin: 'imported' },
        { id: manual, courseId, documentId, kind: 'td', title: 'TD ajouté', origin: 'manual' },
      ])
      .run();
    for (const unitId of [detected, manual]) {
      insertExercises(unitId, documentId, [{ title: 'Ex', contextMd: '', questions: [{ label: '1', statementMd: 'Q', figurePages: [], dependsOnPrevious: false, points: null }] }]);
      createSession(unitId, 'tp');
    }
    expect(documentUnitIds(documentId).sort()).toEqual([detected, manual].sort());
    expect(documentUnitIds(documentId, { keepManual: true })).toEqual([detected]);
    expect(documentSessionsCount(documentId)).toEqual({ count: 2, reanalyzeCount: 1 });
  });
});
