import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  taskCategory,
  taskLabel,
  USAGE_CATEGORY_LABELS,
  type AiHealth,
  type AiUsageStats,
  type UsageCategory,
  type UsageDay,
  type UsageTotals,
} from '@tpassist/shared';
import clsx from 'clsx';
import { AlertTriangle, ChartColumn, Info, RefreshCw, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Markdown } from '../components/Markdown';
import { aiStatusView, useAiHealth } from '../components/AppShell';
import { Button, Callout, EmptyState, ErrorBox, Segmented, Spinner, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { useBreadcrumbs } from '../lib/breadcrumbs';
import { formatCompact, formatDate, formatInt, formatSpan, formatUsd, localDayKey } from '../lib/format';

type Period = '7' | '30' | '90' | 'all';
type Metric = 'cost' | 'calls' | 'tokens';

const DAY_MS = 24 * 3600 * 1000;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function periodStart(p: Period): number {
  if (p === 'all') return 0;
  const d = startOfToday();
  d.setDate(d.getDate() - (Number(p) - 1));
  return d.getTime();
}

const METRICS: Record<Metric, { label: string; value: (t: Omit<UsageTotals, 'durationMs'>) => number; format: (n: number) => string; axis: (n: number) => string }> = {
  cost: { label: 'Coût', value: (t) => t.costUsd, format: formatUsd, axis: (n) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $` },
  calls: { label: 'Appels', value: (t) => t.calls, format: (n) => `${formatInt(n)} appel${n > 1 ? 's' : ''}`, axis: formatCompact },
  tokens: { label: 'Jetons', value: (t) => t.inputTokens + t.outputTokens, format: (n) => `${formatCompact(n)} jetons`, axis: formatCompact },
};

/** Pas « rond » (1, 2, 5 × 10ⁿ) pour des graduations lisibles. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function modelLabel(m: string) {
  return m === 'mock' ? 'Simulation (aucun appel réel)' : m;
}

export function StatsPage() {
  useBreadcrumbs([{ label: 'Statistiques de l’IA' }]);
  const [period, setPeriod] = useState<Period>('30');
  const [metric, setMetric] = useState<Metric>('cost');
  const from = periodStart(period);
  const stats = useQuery({
    queryKey: ['usage-stats', period],
    queryFn: () => api.get<AiUsageStats>(`/api/usage/stats?from=${from}&tz=${new Date().getTimezoneOffset()}`),
    placeholderData: keepPreviousData,
  });
  const qc = useQueryClient();
  const health = useAiHealth();
  const status = aiStatusView(health.data, health.isLoading);
  // Nouveau test réel de la connexion (le serveur garde sinon le résultat 10 min en cache).
  const recheck = useMutation({
    mutationFn: () => api.get<AiHealth>('/api/health/ai?refresh=1'),
    onSuccess: (h) => qc.setQueryData(['health-ai'], h),
  });
  const s = stats.data;

  // Série quotidienne complète (jours sans appel inclus), en jours locaux.
  const days = useMemo(() => {
    if (!s) return [];
    const start = period === 'all' ? (s.allTime.firstCallAt ? new Date(s.allTime.firstCallAt) : startOfToday()) : new Date(from);
    start.setHours(0, 0, 0, 0);
    const byKey = new Map(s.byDay.map((d) => [d.day, d]));
    const out: UsageDay[] = [];
    for (let t = start.getTime(); t <= startOfToday().getTime(); t += DAY_MS) {
      const key = localDayKey(new Date(t));
      out.push(byKey.get(key) ?? { day: key, calls: 0, errors: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 });
    }
    return out;
  }, [s, period, from]);

  const categories = useMemo(() => {
    const m = new Map<UsageCategory, Omit<UsageTotals, 'durationMs'>>();
    for (const t of s?.byTask ?? []) {
      const c = taskCategory(t.task);
      const cur = m.get(c) ?? { calls: 0, errors: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
      m.set(c, {
        calls: cur.calls + t.calls,
        errors: cur.errors + t.errors,
        costUsd: cur.costUsd + t.costUsd,
        inputTokens: cur.inputTokens + t.inputTokens,
        outputTokens: cur.outputTokens + t.outputTokens,
      });
    }
    return [...m.entries()].map(([category, v]) => ({ category, ...v }));
  }, [s]);

  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 pb-24 sm:px-6">
      <header className="mb-8">
        <h1 className="text-3xl leading-tight font-semibold tracking-tight">Utilisation de l’IA</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="flex items-center gap-2 text-ink-3">
            <span className={clsx('size-2 shrink-0 rounded-full', status.dot, (health.isFetching || recheck.isPending) && 'animate-pulse')} />
            <span className="text-ink">{status.label}</span>
            {health.data && (
              <span>
                · {health.data.model} ·{' '}
                {health.data.mock ? 'mode simulation' : health.data.authSource === 'api_key' ? 'clé API Anthropic' : health.data.authSource === 'oauth_token' ? 'abonnement Claude' : 'aucun identifiant'}
              </span>
            )}
          </p>
          <Button size="sm" variant="tertiary" icon={<RefreshCw className="size-4" />} loading={recheck.isPending} onClick={() => recheck.mutate()}>
            Revérifier la connexion
          </Button>
        </div>
        {health.data && !health.data.ok && (
          <Callout tone="red" icon={<AlertTriangle className="size-4" />} title="L’IA n’est pas disponible" className="mt-4">
            <p className="text-sm">{health.data.message}</p>
          </Callout>
        )}
        {recheck.error && <div className="mt-4"><ErrorBox error={recheck.error} /></div>}
      </header>

      {/* Filtres : une seule ligne, au-dessus de tout ce qu'ils filtrent */}
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <Segmented
          value={period}
          onChange={setPeriod}
          items={[
            { value: '7', label: '7 jours' },
            { value: '30', label: '30 jours' },
            { value: '90', label: '90 jours' },
            { value: 'all', label: 'Depuis le début' },
          ]}
        />
        <Segmented value={metric} onChange={setMetric} items={(Object.keys(METRICS) as Metric[]).map((k) => ({ value: k, label: METRICS[k].label }))} />
        {stats.isFetching && <Spinner />}
      </div>

      {stats.isLoading ? (
        <Spinner label="Chargement des statistiques…" />
      ) : stats.error || !s ? (
        <ErrorBox error={stats.error ?? 'Statistiques indisponibles'} onRetry={() => stats.refetch()} />
      ) : (
        <div className={clsx('space-y-12 transition-opacity', stats.isPlaceholderData && 'opacity-50')}>
          <KpiRow s={s} />

          {s.totals.calls === 0 ? (
            <EmptyState icon={<ChartColumn className="size-6" />} title="Aucun appel à l’IA sur cette période">
              Les statistiques apparaîtront dès que tu importeras un PDF ou utiliseras une aide.
            </EmptyState>
          ) : (
            <>
              <section>
                <SectionTitle>{METRICS[metric].label} par jour</SectionTitle>
                <ColumnChart days={days} metric={metric} />
                <Toggle className="mt-4" summary={<span className="text-ink-3">Voir les données par jour</span>}>
                  <DayTable days={days.filter((d) => d.calls > 0)} />
                </Toggle>
              </section>

              <section>
                <SectionTitle>{METRICS[metric].label} par usage</SectionTitle>
                <CategoryBars rows={categories} metric={metric} />
              </section>

              <section>
                <SectionTitle>Détail par tâche</SectionTitle>
                <TaskTable s={s} />
              </section>

              <div className="grid gap-12 lg:grid-cols-2">
                <section>
                  <SectionTitle>Par modèle</SectionTitle>
                  <ul className="space-y-1">
                    {s.byModel.map((m) => (
                      <li key={m.model} className="flex items-baseline justify-between gap-4 rounded px-2 py-2 text-sm hover:bg-hover">
                        <span className="truncate">{modelLabel(m.model)}</span>
                        <span className="shrink-0 text-ink-3 tabular-nums">
                          {formatInt(m.calls)} appel{m.calls > 1 ? 's' : ''} · <span className="text-ink">{formatUsd(m.costUsd)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <SectionTitle>Dernières erreurs</SectionTitle>
                  {s.recentErrors.length === 0 ? (
                    <p className="px-2 text-sm text-ink-3">Aucune erreur sur cette période.</p>
                  ) : (
                    <ul className="space-y-2">
                      {s.recentErrors.map((e) => (
                        <li key={e.id} className="flex gap-3 rounded px-2 py-2 hover:bg-hover">
                          <XCircle className="mt-1 size-4 shrink-0 text-red-600" aria-label="Échec" />
                          <div className="min-w-0 text-sm">
                            <p>
                              {taskLabel(e.task)} <span className="text-ink-3">· {formatDate(e.createdAt)}</span>
                            </p>
                            <p className="line-clamp-2 text-ink-3" title={e.error}>
                              {e.error || 'Erreur inconnue'}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </>
          )}

          <Callout tone="grey" icon={<Info className="size-4" />}>
            <Markdown className="text-sm">
              {`Les coûts sont **estimés** par Claude Code à partir des jetons consommés. Avec une **clé API**, ils correspondent à peu près à ta facture ; avec un **abonnement Claude Pro/Max**, ils sont indicatifs (l’usage est décompté de ton quota, pas facturé). Depuis le début : **${formatUsd(s.allTime.costUsd)}** pour ${formatInt(s.allTime.calls)} appels.`}
            </Markdown>
          </Callout>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-xs font-semibold tracking-wide text-ink-3 uppercase">{children}</h2>;
}

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

function KpiRow({ s }: { s: AiUsageStats }) {
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
              <AlertTriangle className="size-3 text-yellow-600" /> {formatInt(t.errors)} échec{t.errors > 1 ? 's' : ''} · {successRate} % de réussite
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

// ---------- Histogramme quotidien (une seule série : pas de légende, le titre la nomme) ----------

function shortDay(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
}

function longDay(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d));
}

function ColumnChart({ days, metric }: { days: UsageDay[]; metric: Metric }) {
  const [hover, setHover] = useState<number | null>(null);
  const M = METRICS[metric];
  const values = days.map((d) => M.value(d));
  const step = niceStep(Math.max(...values, 0) / 4);
  const top = Math.max(step, Math.ceil(Math.max(...values, 0) / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  // Espacement des dates calculé sur la largeur réelle : ~72 px par étiquette, jamais de chevauchement.
  const axisRef = useRef<HTMLDivElement>(null);
  const [axisW, setAxisW] = useState(640);
  useEffect(() => {
    const el = axisRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAxisW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const slot = axisW / Math.max(1, days.length);
  const labelEvery = Math.max(1, Math.ceil(72 / slot));
  const h = hover !== null ? days[hover] : null;

  return (
    <div>
      <div className="flex gap-2">
        {/* Graduations : discrètes, en texte atténué */}
        <div className="relative h-64 w-16 shrink-0 text-xs text-ink-3 tabular-nums" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: `${(t / top) * 100}%` }}>
              {M.axis(t)}
            </span>
          ))}
        </div>
        <div className="relative h-64 min-w-0 flex-1" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-line" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end" role="list" aria-label={`${M.label} par jour`}>
            {days.map((d, i) => {
              const v = values[i];
              return (
                <div
                  key={d.day}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${longDay(d.day)} : ${M.format(v)}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="flex h-full flex-1 items-end justify-center px-px focus:outline-none"
                >
                  {v > 0 && (
                    <div
                      className={clsx('w-full max-w-6 rounded-t transition-colors', hover === i ? 'bg-blue-600' : 'bg-blue-500')}
                      style={{ height: `${Math.max((v / top) * 100, 1)}%` }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {h && hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 w-48 -translate-x-1/2 rounded-lg bg-raised px-3 py-2 text-sm shadow-e2"
              style={{ left: `${Math.min(Math.max(((hover + 0.5) / days.length) * 100, 15), 85)}%` }}
              role="status"
            >
              <p className="font-semibold">{M.format(values[hover])}</p>
              <p className="text-ink-3 first-letter:uppercase">{longDay(h.day)}</p>
              <p className="mt-1 text-xs text-ink-3">
                {formatInt(h.calls)} appel{h.calls > 1 ? 's' : ''} · {formatUsd(h.costUsd)} · {formatCompact(h.inputTokens + h.outputTokens)} jetons
              </p>
            </div>
          )}
        </div>
      </div>
      {/* Étiquettes de dates, espacées pour rester lisibles */}
      <div className="mt-2 flex gap-2 text-xs text-ink-3" aria-hidden>
        <div className="w-16 shrink-0" />
        <div ref={axisRef} className="relative h-4 min-w-0 flex-1">
          {days.map((d, i) => {
            const last = i === days.length - 1;
            // Extrémités ancrées aux bords (jamais de débordement) ; étiquettes intermédiaires centrées, sans chevaucher la dernière.
            const middle = i > 0 && !last && i % labelEvery === 0 && (days.length - 1 - i) * slot >= 88;
            if (i !== 0 && !last && !middle) return null;
            const style = i === 0 ? { left: 0 } : last ? { right: 0 } : { left: `${((i + 0.5) / days.length) * 100}%` };
            return (
              <span key={d.day} className={clsx('absolute whitespace-nowrap', middle && '-translate-x-1/2')} style={style}>
                {last ? 'Aujourd’hui' : shortDay(d.day)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DayTable({ days }: { days: UsageDay[] }) {
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

function CategoryBars({ rows, metric }: { rows: ({ category: UsageCategory } & Omit<UsageTotals, 'durationMs'>)[]; metric: Metric }) {
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

function TaskTable({ s }: { s: AiUsageStats }) {
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
