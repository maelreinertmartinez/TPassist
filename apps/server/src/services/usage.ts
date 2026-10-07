// Statistiques des appels IA (table ai_calls), agrégées en SQL pour la page Statistiques.
import type { AiUsageStats, UsageTotals } from '@tpassist/shared';
import { rawDb } from '../db/client';

const TOTALS = `count(*) AS calls,
  coalesce(sum(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS errors,
  coalesce(sum(cost_usd), 0) AS costUsd,
  coalesce(sum(input_tokens), 0) AS inputTokens,
  coalesce(sum(output_tokens), 0) AS outputTokens,
  coalesce(sum(duration_ms), 0) AS durationMs`;

const num = (v: unknown) => Number(v ?? 0);

function totals(row: Record<string, unknown>): UsageTotals {
  return {
    calls: num(row.calls),
    errors: num(row.errors),
    costUsd: num(row.costUsd),
    inputTokens: num(row.inputTokens),
    outputTokens: num(row.outputTokens),
    durationMs: num(row.durationMs),
  };
}

/**
 * Statistiques des appels IA depuis `from` (ms, 0 = depuis toujours).
 * `tzOffsetMin` est le décalage du navigateur (Date#getTimezoneOffset) pour regrouper par jour local.
 */
export function usageStats(from: number, tzOffsetMin: number): AiUsageStats {
  const db = rawDb();
  const since = Math.max(0, Math.floor(from));
  const shift = Math.round(tzOffsetMin) * 60;

  const t = db.prepare(`SELECT ${TOTALS} FROM ai_calls WHERE created_at >= ?`).get(since) as Record<string, unknown>;
  const all = db.prepare('SELECT count(*) AS calls, coalesce(sum(cost_usd), 0) AS costUsd, min(created_at) AS first FROM ai_calls').get() as Record<string, unknown>;

  const byDay = (
    db
      .prepare(
        `SELECT strftime('%Y-%m-%d', (created_at / 1000) - ?, 'unixepoch') AS day, ${TOTALS}
         FROM ai_calls WHERE created_at >= ? GROUP BY day ORDER BY day`,
      )
      .all(shift, since) as Record<string, unknown>[]
  ).map((r) => {
    const { durationMs: _d, ...rest } = totals(r);
    return { day: String(r.day), ...rest };
  });

  const byTask = (
    db.prepare(`SELECT task, ${TOTALS} FROM ai_calls WHERE created_at >= ? GROUP BY task ORDER BY costUsd DESC, calls DESC`).all(since) as Record<string, unknown>[]
  ).map((r) => ({ task: String(r.task), ...totals(r) }));

  const byModel = (
    db
      .prepare('SELECT model, count(*) AS calls, coalesce(sum(cost_usd), 0) AS costUsd FROM ai_calls WHERE created_at >= ? GROUP BY model ORDER BY costUsd DESC, calls DESC')
      .all(since) as Record<string, unknown>[]
  ).map((r) => ({ model: String(r.model), calls: num(r.calls), costUsd: num(r.costUsd) }));

  const recentErrors = (
    db
      .prepare('SELECT id, task, model, coalesce(error, \'\') AS error, created_at AS createdAt FROM ai_calls WHERE ok = 0 AND created_at >= ? ORDER BY created_at DESC LIMIT 10')
      .all(since) as Record<string, unknown>[]
  ).map((r) => ({ id: String(r.id), task: String(r.task), model: String(r.model), error: String(r.error), createdAt: num(r.createdAt) }));

  return {
    from: since,
    totals: totals(t),
    allTime: { calls: num(all.calls), costUsd: num(all.costUsd), firstCallAt: all.first == null ? null : num(all.first) },
    byDay,
    byTask,
    byModel,
    recentErrors,
  };
}
