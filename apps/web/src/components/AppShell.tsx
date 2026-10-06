import { useQuery } from '@tanstack/react-query';
import type { AiHealth } from '@tpassist/shared';
import clsx from 'clsx';
import { ChevronRight, GraduationCap } from 'lucide-react';
import { Fragment } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { api } from '../lib/api';
import { BreadcrumbProvider, useCrumbs } from '../lib/breadcrumbs';
import { ConfirmProvider } from './ui';

export function AiStatus() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['health-ai'],
    queryFn: () => api.get<AiHealth>('/api/health/ai'),
    staleTime: 10 * 60 * 1000,
  });
  const dot = isLoading ? 'bg-grey-400' : data?.ok ? (data.mock ? 'bg-yellow-500' : 'bg-green-500') : 'bg-red-500';
  const label = isLoading ? 'Vérification de l’IA…' : data?.ok ? (data.mock ? 'IA simulée' : 'IA connectée') : 'IA indisponible';
  return (
    <button
      type="button"
      onClick={() => refetch()}
      title={data ? `${data.message}\nModèle : ${data.model}\nCliquer pour revérifier` : ''}
      className="no-print inline-flex shrink-0 items-center gap-2 rounded px-2 py-1 text-sm whitespace-nowrap text-ink-3 transition-colors hover:bg-hover hover:text-ink"
    >
      <span className={clsx('size-2 shrink-0 rounded-full', dot, isFetching && 'animate-pulse')} />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
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
