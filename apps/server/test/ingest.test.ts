import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractJson, toJsonSchema } from '../src/ai/agent';
import * as schemas from '../src/ai/schemas';
import { groupMatchedSolutions, heuristicLinkCorrections } from '../src/ingest/corrections';
import { classifyPageText, mockExtractExercises } from '../src/ingest/mockHeuristics';
import { mergeExerciseBatches, mergePagesIntoUnits, mergeSectionBatches, normalizeLabel, type PageClass } from '../src/ingest/segment';

const p = (page: number, kind: PageClass['kind'], unitTitle: string, startsNewUnit = false, startsMidPage = false): PageClass => ({
  page,
  kind,
  unitTitle,
  startsNewUnit,
  startsMidPage,
});

describe('segmentation : fusion des pages en parties', () => {
  it('PDF mixte : cours puis TD puis TP', () => {
    const units = mergePagesIntoUnits([
      p(1, 'cours', 'Chapitre 1', true),
      p(2, 'cours', 'Chapitre 1'),
      p(3, 'td', 'TD 1', true),
      p(4, 'td', 'TD 1'),
      p(5, 'tp', 'TP 1', true),
    ]);
    expect(units).toEqual([
      { kind: 'cours', title: 'Chapitre 1', pageStart: 1, pageEnd: 2 },
      { kind: 'td', title: 'TD 1', pageStart: 3, pageEnd: 4 },
      { kind: 'tp', title: 'TP 1', pageStart: 5, pageEnd: 5 },
    ]);
  });

  it('page partagée : la nouvelle partie commence au milieu de la page', () => {
    const units = mergePagesIntoUnits([p(1, 'cours', 'Chapitre 1', true), p(2, 'cours', 'Chapitre 1'), p(3, 'td', 'TD 1', true, true), p(4, 'td', 'TD 1')]);
    expect(units[0]).toMatchObject({ kind: 'cours', pageStart: 1, pageEnd: 3 });
    expect(units[1]).toMatchObject({ kind: 'td', pageStart: 3, pageEnd: 4 });
  });

  it('TD suivi de son corrigé dans le même PDF', () => {
    const units = mergePagesIntoUnits([p(1, 'td', 'TD 3', true), p(2, 'td', 'TD 3'), p(3, 'corrige', 'Corrigé du TD 3', true), p(4, 'corrige', 'Corrigé du TD 3')]);
    expect(units.map((u) => [u.kind, u.pageStart, u.pageEnd])).toEqual([
      ['td', 1, 2],
      ['corrige', 3, 4],
    ]);
  });

  it('deux chapitres consécutifs et pages « autre »', () => {
    const units = mergePagesIntoUnits([p(1, 'autre', ''), p(2, 'cours', 'Ch. 1', true), p(3, 'autre', ''), p(4, 'cours', 'Ch. 2', true)]);
    expect(units).toEqual([
      { kind: 'cours', title: 'Ch. 1', pageStart: 2, pageEnd: 3 },
      { kind: 'cours', title: 'Ch. 2', pageStart: 4, pageEnd: 4 },
    ]);
  });

  it('titre par défaut si absent', () => {
    expect(mergePagesIntoUnits([p(1, 'tp', '', true)])[0].title).toBe('TP 1');
  });

  it('pages non triées', () => {
    expect(mergePagesIntoUnits([p(2, 'td', 'TD'), p(1, 'td', 'TD', true)])).toEqual([{ kind: 'td', title: 'TD', pageStart: 1, pageEnd: 2 }]);
  });
});

describe('fusion des extractions par lots', () => {
  const q = (label: string) => ({ label, statementMd: `Q${label}`, figurePages: [], dependsOnPrevious: false, points: null, inlineSolutionMd: null });
  it('un exercice coupé entre deux lots est recollé', () => {
    const out = mergeExerciseBatches([
      [{ title: 'Ex 1', continuesPrevious: false, contextMd: 'A', questions: [q('1')] }],
      [
        { title: 'Ex 1 (suite)', continuesPrevious: true, contextMd: '', questions: [q('2')] },
        { title: 'Ex 2', continuesPrevious: false, contextMd: '', questions: [q('1')] },
      ],
    ]);
    expect(out.map((e) => [e.title, e.questions.map((x) => x.label)])).toEqual([
      ['Ex 1', ['1', '2']],
      ['Ex 2', ['1']],
    ]);
  });
  it('un exercice sans question devient une question unique', () => {
    const out = mergeExerciseBatches([[{ title: 'Ex', continuesPrevious: false, contextMd: 'Démontrer que…', questions: [] }]]);
    expect(out[0].questions[0].statementMd).toBe('Démontrer que…');
    expect(out[0].contextMd).toBe('');
  });
  it('sections de cours coupées', () => {
    const out = mergeSectionBatches([
      [{ title: 'S1', pageStart: 1, pageEnd: 2, summary: 'a', keyConcepts: ['x'], contentMd: 'A', continuesPrevious: false }],
      [{ title: 'S1', pageStart: 3, pageEnd: 3, summary: 'b', keyConcepts: ['x', 'y'], contentMd: 'B', continuesPrevious: true }],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ pageEnd: 3, contentMd: 'A\n\nB', keyConcepts: ['x', 'y'] });
  });
});

describe('corrigés', () => {
  const sols = [
    { exerciseLabel: 'Exercice 1', questionLabel: '1', solutionMd: 'S1', pageStart: 4, pageEnd: 4 },
    { exerciseLabel: 'Exercice 1', questionLabel: '2', solutionMd: 'S2', pageStart: 4, pageEnd: 5 },
    { exerciseLabel: 'Exercice 1', questionLabel: '2', solutionMd: 'S2bis', pageStart: 5, pageEnd: 5 },
  ];
  it('regroupe plusieurs morceaux pour une même question', () => {
    const g = groupMatchedSolutions(sols, [
      { solutionIndex: 0, questionId: 'q1' },
      { solutionIndex: 2, questionId: 'q2' },
      { solutionIndex: 1, questionId: 'q2' },
    ]);
    expect(g.get('q1')).toEqual({ solutionMd: 'S1', pages: [4] });
    expect(g.get('q2')).toEqual({ solutionMd: 'S2\n\nS2bis', pages: [4, 5] });
  });
  it('rattachement heuristique par titre et numéros', () => {
    const r = heuristicLinkCorrections(
      [{ id: 'c', title: 'Corrigé du TD 1 - Calcul matriciel', targetTitle: 'TD 1 - Calcul matriciel', solutions: sols }],
      [
        { id: 'tp', title: 'TP 2 - Python', questions: [] },
        {
          id: 'td',
          title: 'TD 1 - Calcul matriciel',
          questions: [
            { id: 'q1', exerciseTitle: 'Exercice 1 - Produit', label: '1)' },
            { id: 'q2', exerciseTitle: 'Exercice 1 - Produit', label: '2' },
          ],
        },
      ],
    );
    expect(r.links[0].targetUnitId).toBe('td');
    expect(r.links[0].matches).toEqual([
      { solutionIndex: 0, questionId: 'q1' },
      { solutionIndex: 1, questionId: 'q2' },
      { solutionIndex: 2, questionId: 'q2' },
    ]);
  });
  it('normalisation des numéros', () => {
    expect(normalizeLabel('Q1.a)')).toBe('1a');
    expect(normalizeLabel('Question 2')).toBe('2');
  });
});

describe('heuristiques du mode simulation', () => {
  it('classe les pages', () => {
    expect(classifyPageText('TD 1 - Calcul matriciel\nExercice 1')).toBe('td');
    expect(classifyPageText('Corrige du TD 1')).toBe('corrige');
    expect(classifyPageText('EI 2025 - Algebre')).toBe('ei');
    expect(classifyPageText('Chapitre 1 - Matrices')).toBe('cours');
  });
  it('extrait exercices et questions', () => {
    const r = mockExtractExercises([{ page: 1, text: 'TD 1\nExercice 1 - Produit\nSoit A.\n1) Calculer AB.\n2) Calculer BA.\nExercice 2\n1) det' }], 'td');
    expect(r.exercises.map((e) => e.questions.length)).toEqual([2, 1]);
    expect(r.exercises[0].contextMd).toBe('Soit A.');
  });
});

describe('schémas de sortie structurée', () => {
  it('tous les schémas se convertissent en JSON Schema draft-07', () => {
    for (const [name, s] of Object.entries(schemas)) {
      if (!(s instanceof z.ZodType) || s instanceof z.ZodEnum) continue;
      const js = toJsonSchema(s);
      expect(js.$schema, name).toMatch(/draft-07/);
      expect(js.type, name).toBe('object');
    }
  });
  it('repli : extraction du JSON depuis le texte', () => {
    expect(extractJson('Voici :\n```json\n{"ok": true}\n```')).toEqual({ ok: true });
    expect(extractJson('Réponse {"verdict":"correct","errorLocation":null} fin')).toEqual({ verdict: 'correct', errorLocation: null });
    expect(extractJson('pas de json')).toBeUndefined();
  });
  it('validation : un verdict inconnu est rejeté', () => {
    expect(schemas.VerifySchema.safeParse({ verdict: 'bof', errorLocation: null, errorExplanation: null }).success).toBe(false);
  });
});
