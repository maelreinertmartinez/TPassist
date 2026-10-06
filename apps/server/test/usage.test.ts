import { taskCategory, taskLabel } from '@tpassist/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, newId, openDb } from '../src/db/client';
import { aiCalls } from '../src/db/schema';
import { usageStats } from '../src/services/usage';

const H = 3600 * 1000;
// 6 oct. 2026 23:30 UTC = 7 oct. 01:30 à Paris (UTC+2, getTimezoneOffset = -120).
const T = Date.UTC(2026, 9, 6, 23, 30);

beforeAll(() => {
  openDb(':memory:');
  const rows = [
    { task: 'ingest.segment', model: 'claude-sonnet-5-5', ok: true, costUsd: 0.5, inputTokens: 1000, outputTokens: 200, durationMs: 4000, createdAt: T },
    { task: 'tutor.hint', model: 'claude-sonnet-5-5', ok: true, costUsd: 0.1, inputTokens: 300, outputTokens: 50, durationMs: 2000, createdAt: T - 2 * H },
    { task: 'tutor.verify', model: 'claude-opus-5-5', ok: false, costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 500, createdAt: T - 30 * H, error: 'boom' },
  ];
  for (const r of rows) db.insert(aiCalls).values({ id: newId(), ...r }).run();
});

describe('statistiques d’utilisation', () => {
  it('totaux sur toute la période', () => {
    const s = usageStats(0, 0);
    expect(s.totals).toEqual({ calls: 3, errors: 1, costUsd: 0.6, inputTokens: 1300, outputTokens: 250, durationMs: 6500 });
    expect(s.allTime.calls).toBe(3);
    expect(s.allTime.firstCallAt).toBe(T - 30 * H);
  });

  it('regroupe par jour local selon le fuseau du navigateur', () => {
    expect(usageStats(0, 0).byDay.map((d) => [d.day, d.calls])).toEqual([
      ['2026-10-05', 1],
      ['2026-10-06', 2],
    ]);
    // À Paris, l'appel de 23:30 UTC tombe le 7 octobre.
    expect(usageStats(0, -120).byDay.map((d) => [d.day, d.calls])).toEqual([
      ['2026-10-05', 1],
      ['2026-10-06', 1],
      ['2026-10-07', 1],
    ]);
  });

  it('filtre la période et classe tâches, modèles et erreurs', () => {
    const s = usageStats(T - 3 * H, 0);
    expect(s.totals.calls).toBe(2);
    expect(s.byTask.map((t) => t.task)).toEqual(['ingest.segment', 'tutor.hint']);
    expect(s.recentErrors).toEqual([]);
    expect(usageStats(0, 0).recentErrors[0]).toMatchObject({ task: 'tutor.verify', error: 'boom' });
    expect(usageStats(0, 0).byModel[0]).toMatchObject({ model: 'claude-sonnet-5-5', calls: 2 });
  });

  it('libellés et catégories des tâches', () => {
    expect(taskLabel('tutor.hint')).toBe('Indication');
    expect(taskLabel('inconnue')).toBe('inconnue');
    expect(taskCategory('ingest.td')).toBe('ingest');
    expect(taskCategory('tutor.verify')).toBe('verify');
    expect(taskCategory('quiz.grade_open')).toBe('verify');
    expect(taskCategory('tutor.solution')).toBe('help');
    expect(taskCategory('health')).toBe('other');
  });
});
