// Page Statistiques (ouverte depuis l'état de l'IA) : connexion, coût, appels et jetons par jour, par usage, par tâche et par modèle.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  taskCategory,
  taskLabel,
  type AiHealth,
  type AiUsageStats,
  type UsageCategory,
  type UsageDay,
  type UsageTotals,
} from '@tpassist/shared';
import clsx from 'clsx';
import { AlertTriangle, ChartColumn, Info, RefreshCw, XCircle } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Markdown } from '../../components/Markdown';
import { aiStatusView, useAiHealth } from '../../components/AppShell';
import { Button, Callout, EmptyState, ErrorBox, Page, Segmented, Spinner, Toggle } from '../../components/ui';
import { api } from '../../lib/api';
import { useBreadcrumbs } from '../../lib/breadcrumbs';
import { formatDate, formatInt, formatUsd, localDayKey, pluralWord } from '../../lib/format';
import { CategoryBars, DayTable, KpiRow, TaskTable } from './tables';
import { ColumnChart } from './ColumnChart';
import { DAY_MS, METRICS, modelLabel, periodStart, startOfToday, type Metric, type Period } from './metrics';

/** Page Statistiques (route /stats). */
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
    <Page>
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
                          {formatInt(m.calls)} {pluralWord(m.calls, 'appel')} · <span className="text-ink">{formatUsd(m.costUsd)}</span>
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
    </Page>
  );
}

/** Titre de section de la page. */
function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-xs font-semibold tracking-wide text-ink-3 uppercase">{children}</h2>;
}
