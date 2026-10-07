// Périodes, métriques et mise en forme des dates de la page Statistiques.
import type { UsageTotals } from '@tpassist/shared';
import { formatCompact, formatInt, formatUsd, pluralWord } from '../../lib/format';

/** Période affichée, en jours (`all` : depuis toujours). */
export type Period = '7' | '30' | '90' | 'all';
/** Mesure affichée. */
export type Metric = 'cost' | 'calls' | 'tokens';

/** Durée d’un jour en millisecondes. */
export const DAY_MS = 24 * 3600 * 1000;

/** Aujourd’hui à minuit (heure locale). */
export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Début d’une période (ms) ; 0 pour « depuis toujours ». */
export function periodStart(p: Period): number {
  if (p === 'all') return 0;
  const d = startOfToday();
  d.setDate(d.getDate() - (Number(p) - 1));
  return d.getTime();
}

/** Libellé, valeur et mises en forme de chaque mesure. */
export const METRICS: Record<Metric, { label: string; value: (t: Omit<UsageTotals, 'durationMs'>) => number; format: (n: number) => string; axis: (n: number) => string }> = {
  cost: { label: 'Coût', value: (t) => t.costUsd, format: formatUsd, axis: (n) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $` },
  calls: { label: 'Appels', value: (t) => t.calls, format: (n) => `${formatInt(n)} ${pluralWord(n, 'appel')}`, axis: formatCompact },
  tokens: { label: 'Jetons', value: (t) => t.inputTokens + t.outputTokens, format: (n) => `${formatCompact(n)} jetons`, axis: formatCompact },
};

/** Pas « rond » (1, 2, 5 × 10ⁿ) pour des graduations lisibles. */
export function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/** Libellé d’un modèle (le mode simulation est nommé clairement). */
export function modelLabel(m: string) {
  return m === 'mock' ? 'Simulation (aucun appel réel)' : m;
}

/** Jour court : « 6 oct. ». */
export function shortDay(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
}

/** Jour long : « mardi 6 octobre ». */
export function longDay(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d));
}
