// Cadre commun des pages : barre du haut (fil d'Ariane, état de l'IA), fournisseurs du fil d'Ariane et des confirmations.
import { useQuery } from '@tanstack/react-query';
import type { AiHealth } from '@tpassist/shared';
import clsx from 'clsx';
import { ChevronRight, GraduationCap } from 'lucide-react';
import { Fragment } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { api } from '../lib/api';
import { BreadcrumbProvider, useCrumbs } from '../lib/breadcrumbs';
import { ConfirmProvider } from './ui';

/** État de la connexion à l'IA (le serveur garde le résultat 10 minutes). */
export function useAiHealth() {
  return useQuery({
    queryKey: ['health-ai'],
    queryFn: () => api.get<AiHealth>('/api/health/ai'),
    staleTime: 10 * 60 * 1000,
  });
}

/** Pastille de couleur et libellé de l'état de l'IA. */
export function aiStatusView(data: AiHealth | undefined, isLoading: boolean) {
  const dot = isLoading ? 'bg-grey-400' : data?.ok ? (data.mock ? 'bg-yellow-500' : 'bg-green-500') : 'bg-red-500';
  const label = isLoading ? 'Vérification de l’IA…' : data?.ok ? (data.mock ? 'IA simulée' : 'IA connectée') : 'IA indisponible';
  return { dot, label };
}

/** État de l'IA dans la barre du haut : ouvre la page des statistiques d'utilisation. */
function AiStatus() {
  const { data, isLoading, isFetching } = useAiHealth();
  const { dot, label } = aiStatusView(data, isLoading);
  return (
    <NavLink
      to="/stats"
      title={`${data ? `${data.message}\n` : ''}Voir les statistiques d’utilisation de l’IA`}
      className={({ isActive }) =>
        clsx(
          'no-print inline-flex shrink-0 items-center gap-2 rounded px-2 py-1 text-sm whitespace-nowrap transition-colors hover:bg-hover hover:text-ink',
          isActive ? 'bg-hover text-ink' : 'text-ink-3',
        )
      }
    >
      <span className={clsx('size-2 shrink-0 rounded-full', dot, isFetching && 'animate-pulse')} />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </NavLink>
  );
}

function TopBar() {
  const crumbs = useCrumbs();
  return (
    <header className="no-print sticky top-0 z-30 bg-page">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <nav className="flex min-w-0 items-center gap-1 text-sm" aria-label="Fil d’Ariane">
          <Link to="/" className="flex shrink-0 items-center gap-2 rounded px-2 py-1 font-semibold text-ink hover:bg-hover">
            <span className="grid size-6 place-items-center rounded bg-accent text-accent-ink">
              <GraduationCap className="size-4" />
            </span>
            TPassist
          </Link>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={i}>
                <ChevronRight className="size-4 shrink-0 text-ink-4" />
                {c.to && !last ? (
                  <Link to={c.to} className="truncate rounded px-2 py-1 text-ink-3 hover:bg-hover hover:text-ink">
                    {c.label}
                  </Link>
                ) : (
                  <span className={clsx('truncate px-2 py-1', last ? 'text-ink' : 'text-ink-3')}>{c.label}</span>
                )}
              </Fragment>
            );
          })}
        </nav>
        <AiStatus />
      </div>
    </header>
  );
}

/** Mise en page de toutes les routes (les pages s'affichent dans l'Outlet). */
export function AppShell() {
  return (
    <BreadcrumbProvider>
      <ConfirmProvider>
        <div className="flex min-h-screen flex-col">
          <TopBar />
          <main className="flex-1">
            <Outlet />
          </main>
        </div>
      </ConfirmProvider>
    </BreadcrumbProvider>
  );
}
