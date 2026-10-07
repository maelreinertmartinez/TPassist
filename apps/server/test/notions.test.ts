import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.TPASSIST_AI_MOCK = '1';
});

import { db, newId, openDb } from '../src/db/client';
import { deleteUnits, insertSection } from '../src/db/repo';
import { courses, jobs, units } from '../src/db/schema';
import { generateNotions, sanitizeNotions } from '../src/jobs/generateNotions';
import type { JobRow } from '../src/jobs/queue';
import { getNotionDetail, getNotionMap, matchWeakPoints, requestNotionMap, streamNotionDetail } from '../src/services/notions';

const raw = (o: Partial<Parameters<typeof sanitizeNotions>[0][number]>) => ({
  key: 'a',
  title: 'A',
  summary: '',
  kind: 'concept' as const,
  parentKey: null,
  sectionIds: [],
  prerequisiteKeys: [],
  ...o,
});

function seed() {
  const courseId = newId();
  const ch1 = newId();
  const ch2 = newId();
  db.insert(courses).values({ id: courseId, name: 'Algèbre' }).run();
  db.insert(units)
    .values([
      { id: ch1, courseId, kind: 'cours', title: 'Chapitre 1', order: 1 },
      { id: ch2, courseId, kind: 'cours', title: 'Chapitre 2', order: 2 },
      { id: newId(), courseId, kind: 'td', title: 'TD 1', order: 3 },
    ])
    .run();
  const sec = (unitId: string, order: number, title: string, keyConcepts: string[]) =>
    insertSection({ unitId, courseId, order, title, pageStart: 1, pageEnd: 2, summary: `Résumé de ${title}.`, keyConcepts, contentMd: `Contenu de ${title}` });
  sec(ch1, 0, 'Espaces vectoriels', ['Sous-espace', 'Famille libre']);
  sec(ch1, 1, 'Base et dimension', ['Théorème de la base incomplète']);
  sec(ch2, 0, 'Applications linéaires', ['Noyau']);
  return { courseId, ch1, ch2, sec };
}

const run = (courseId: string) => generateNotions({ courseId } as JobRow, { progress: () => {} });

beforeEach(() => {
  openDb(':memory:');
});

describe('nettoyage de la carte renvoyée par l’IA', () => {
  it('garde 2 niveaux, des clés uniques et des références connues', () => {
    const out = sanitizeNotions(
      [
        raw({ key: 'a', title: 'Base', sectionIds: ['s1', 'inconnue', 's1'], prerequisiteKeys: ['a', 'b', 'ancienne', 'inconnue'] }),
        raw({ key: 'b', title: 'Dimension', parentKey: 'a' }),
        raw({ key: 'c', title: 'Rang', parentKey: 'b' }),
        raw({ key: 'a', title: 'Doublon' }),
        raw({ key: 'd', title: 'Boucle 1', parentKey: 'e' }),
        raw({ key: 'e', title: 'Boucle 2', parentKey: 'd' }),
        raw({ key: 'f', title: '   ' }),
        raw({ key: 'g', title: 'Orpheline', parentKey: 'absente' }),
      ],
      new Set(['s1']),
      new Set(['ancienne']),
    );
    const by = Object.fromEntries(out.map((n) => [n.key, n]));
    expect(out.map((n) => n.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'g']);
    expect(by.a.title).toBe('Base');
    expect(by.a.sectionIds).toEqual(['s1']);
    expect(by.a.prerequisiteKeys).toEqual(['b', 'ancienne']);
    expect(by.b.parentKey).toBe('a');
    expect(by.c.parentKey).toBe('a');
    expect([by.d.parentKey, by.e.parentKey, by.g.parentKey]).toEqual([null, null, null]);
  });
});

describe('génération de la carte des notions', () => {
  it('construit l’arbre par chapitre avec des prérequis entre chapitres', async () => {
    const { courseId, ch1, ch2 } = seed();
    await run(courseId);
    const map = getNotionMap(courseId);
    expect(map.notions).toHaveLength(7);
    expect(map.stale).toBe(false);
    expect(map.generatedAt).not.toBeNull();
    const byTitle = Object.fromEntries(map.notions.map((n) => [n.title, n]));
    expect(byTitle['Espaces vectoriels'].parentId).toBeNull();
    expect(byTitle['Sous-espace'].parentId).toBe(byTitle['Espaces vectoriels'].id);
    expect(byTitle['Théorème de la base incomplète'].kind).toBe('theoreme');
    expect(byTitle['Base et dimension'].prerequisiteIds).toEqual([byTitle['Espaces vectoriels'].id]);
    // Prérequis venant du chapitre précédent.
    const app = byTitle['Applications linéaires'];
    expect(app.unitId).toBe(ch2);
    expect(app.prerequisiteIds).toEqual([byTitle['Théorème de la base incomplète'].id]);
    expect(byTitle['Théorème de la base incomplète'].unitId).toBe(ch1);
  });

  it('garde les fiches déjà rédigées quand on régénère', async () => {
    const { courseId } = seed();
    await run(courseId);
    const base = getNotionMap(courseId).notions.find((n) => n.title === 'Base et dimension')!;
    expect((await streamNotionDetail(base.id, false)).cached).toBe(false);
    expect((await streamNotionDetail(base.id, false)).cached).toBe(true);
    await run(courseId);
    const after = getNotionMap(courseId).notions;
    const again = after.find((n) => n.title === 'Base et dimension')!;
    expect(again.id).not.toBe(base.id);
    expect(getNotionDetail(again.id).detailMd).toBeTruthy();
    expect(after.filter((n) => getNotionDetail(n.id).detailMd)).toHaveLength(1);
  });

  it('signale une carte périmée quand les chapitres changent', async () => {
    const { courseId, ch2, sec } = seed();
    await run(courseId);
    sec(ch2, 1, 'Rang', []);
    expect(getNotionMap(courseId).stale).toBe(true);
    await run(courseId);
    expect(getNotionMap(courseId).stale).toBe(false);
    deleteUnits([ch2]);
    const map = getNotionMap(courseId);
    expect(map.stale).toBe(true);
    expect(map.notions.every((n) => n.unitId !== ch2)).toBe(true);
  });

  it('ne se lance que sur un cours qui a des chapitres, sans doublon', () => {
    vi.useFakeTimers();
    try {
      const empty = newId();
      db.insert(courses).values({ id: empty, name: 'Vide' }).run();
      expect(() => requestNotionMap(empty)).toThrow(/chapitre de cours/);
      const { courseId } = seed();
      const first = requestNotionMap(courseId);
      expect(requestNotionMap(courseId).id).toBe(first.id);
      expect(db.select().from(jobs).all()).toHaveLength(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('points bloquants liés aux notions', () => {
  it('par le libellé, sinon par les sections des notions principales', () => {
    const list = [
      { id: 'noyau', title: 'Noyau', parentId: 'app', sectionIds: ['s'] },
      { id: 'app', title: 'Applications linéaires', parentId: null, sectionIds: ['s'] },
      { id: 'rang', title: 'Rang', parentId: null, sectionIds: ['t'] },
    ];
    const m = matchWeakPoints(list, [
      { id: 'w1', notion: 'Calcul du noyau d’une application', descriptionMd: '', sectionIds: ['t'] },
      { id: 'w2', notion: 'Confusions', descriptionMd: 'Mélange les définitions.', sectionIds: ['t'] },
    ]);
    expect(m.get('noyau')).toEqual(['w1']);
    expect(m.get('rang')).toEqual(['w2']);
    expect(m.get('app')).toBeUndefined();
  });
});
