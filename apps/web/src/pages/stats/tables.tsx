// Chiffres clés, tableau par jour, répartition par usage et tableau détaillé par tâche.
import { taskCategory, taskLabel, USAGE_CATEGORY_LABELS, type AiUsageStats, type UsageCategory, type UsageDay, type UsageTotals } from '@tpassist/shared';
import { AlertTriangle, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatCompact, formatInt, formatSpan, formatUsd, pluralWord } from '../../lib/format';
import { longDay, METRICS, type Metric } from './metrics';

// ---------- Chiffres clés ----------

function StatTile({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="rounded-lg bg-block px-4 py-4">
      <p className="text-sm text-ink-3">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

/** Chiffres clés de la période. */
export function KpiRow({ s }: { s: AiUsageStats }) {
  const t = s.totals;
  const successRate = t.calls ? Math.round(((t.calls - t.errors) / t.calls) * 100) : 100;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile label="Coût estimé" value={formatUsd(t.costUsd)} sub={t.calls ? `${formatUsd(t.costUsd / t.calls)} par appel en moyenne` : 'aucun appel'} />
      <StatTile
        label="Appels à l’IA"
        value={formatInt(t.calls)}
        sub={
          t.errors > 0 ? (
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="size-3 text-yellow-600" /> {formatInt(t.errors)} {pluralWord(t.errors, 'échec')} · {successRate} % de réussite
            </span>
          ) : (
            'aucun échec'
          )
        }
      />
      <StatTile label="Jetons envoyés" value={formatCompact(t.inputTokens)} sub={`${formatCompact(t.outputTokens)} jetons générés par l’IA`} />
      <StatTile label="Durée moyenne d’un appel" value={t.calls ? formatSpan(t.durationMs / t.calls) : '—'} sub={`${formatSpan(t.durationMs)} au total`} />
    </div>
  );
}

/** Détail jour par jour, en tableau (alternative accessible à l’histogramme). */
export function DayTable({ days }: { days: UsageDay[] }) {
  if (days.length === 0) return <p className="text-sm text-ink-3">Aucun appel sur cette période.</p>;
  return (
    <div className="overflow-x-auto pb-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-3">
            <th className="py-2 pr-4 font-normal">Jour</th>
            <th className="py-2 pr-4 text-right whitespace-nowrap font-normal">Appels</th>
            <th className="py-2 pr-4 text-right whitespace-nowrap font-normal">Jetons</th>
            <th className="py-2 text-right whitespace-nowrap font-normal">Coût</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {[...days].reverse().map((d) => (
            <tr key={d.day} className="border-t border-line">
              <td className="py-2 pr-4 first-letter:uppercase">{longDay(d.day)}</td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">{formatInt(d.calls)}</td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">{formatCompact(d.inputTokens + d.outputTokens)}</td>
              <td className="py-2 text-right whitespace-nowrap">{formatUsd(d.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Répartition par usage (barres horizontales, une seule teinte) ----------

export function CategoryBars({ rows, metric }: { rows: ({ category: UsageCategory } & Omit<UsageTotals, 'durationMs'>)[]; metric: Metric }) {
  const M = METRICS[metric];
  const sorted = [...rows].sort((a, b) => M.value(b) - M.value(a) || b.calls - a.calls);
  const max = Math.max(...sorted.map((r) => M.value(r)), 0);
  const total = sorted.reduce((a, r) => a + M.value(r), 0);
  return (
    <ul className="space-y-3">
      {sorted.map((r) => {
        const v = M.value(r);
        const share = total ? Math.round((v / total) * 100) : 0;
        return (
          <li key={r.category} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-3">
            <span className="truncate text-sm">{USAGE_CATEGORY_LABELS[r.category]}</span>
            <div className="flex items-center gap-3 sm:col-span-2">
              <div className="h-4 min-w-0 flex-1">
                {v > 0 && (
                  <div
                    className="h-full rounded-r bg-blue-500"
                    style={{ width: `${Math.max((v / (max || 1)) * 100, 1)}%` }}
                    title={`${USAGE_CATEGORY_LABELS[r.category]} : ${M.format(v)}`}
                  />
                )}
              </div>
              <span className="w-32 shrink-0 text-right text-sm text-ink-2 tabular-nums">
                {M.format(v)} <span className="text-ink-3">· {share} %</span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Tableau détaillé ----------

export function TaskTable({ s }: { s: AiUsageStats }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-3">
            <th className="py-2 pr-4 font-normal">Tâche</th>
            <th className="py-2 pr-4 text-right whitespace-nowrap font-normal">Appels</th>
            <th className="py-2 pr-4 text-right whitespace-nowrap font-normal">Jetons envoyés</th>
            <th className="py-2 pr-4 text-right whitespace-nowrap font-normal">Jetons générés</th>
            <th className="py-2 pr-4 text-right whitespace-nowrap font-normal">Durée moy.</th>
            <th className="py-2 text-right whitespace-nowrap font-normal">Coût</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {s.byTask.map((t) => (
            <tr key={t.task} className="border-t border-line">
              <td className="py-2 pr-4">
                <p>{taskLabel(t.task)}</p>
                <p className="text-xs text-ink-3">{USAGE_CATEGORY_LABELS[taskCategory(t.task)]}</p>
              </td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">
                {formatInt(t.calls)}
                {t.errors > 0 && (
                  <span className="ml-1 inline-flex items-center gap-1 text-xs text-red-600" title={`${t.errors} échec(s)`}>
                    <XCircle className="size-3" /> {t.errors}
                  </span>
                )}
              </td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">{formatCompact(t.inputTokens)}</td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">{formatCompact(t.outputTokens)}</td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">{t.calls ? formatSpan(t.durationMs / t.calls) : '—'}</td>
              <td className="py-2 text-right whitespace-nowrap font-semibold">{formatUsd(t.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
