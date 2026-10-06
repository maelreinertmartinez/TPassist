import { useQuery } from '@tanstack/react-query';
import type { AiHealth } from '@tpassist/shared';
import clsx from 'clsx';
import { GraduationCap } from 'lucide-react';
import { Link, Outlet } from 'react-router-dom';
import { api } from '../lib/api';

export function AiStatus() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['health-ai'],
    queryFn: () => api.get<AiHealth>('/api/health/ai'),
    staleTime: 10 * 60 * 1000,
  });
  const tone = isLoading ? 'bg-muted' : data?.ok ? (data.mock ? 'bg-warn' : 'bg-ok') : 'bg-bad';
  const label = isLoading ? 'Vérification de l’IA…' : data?.ok ? (data.mock ? 'IA simulée' : 'IA connectée') : 'IA indisponible';
  return (
    <button
      onClick={() => refetch()}
      title={data ? `${data.message}\nModèle : ${data.model}\nCliquer pour revérifier` : ''}
      className="no-print inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted hover:text-ink"
    >
      <span className={clsx('size-2 rounded-full', tone, isFetching && 'animate-pulse')} />
      {label}
    </button>
  );
}

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-ink">
              <GraduationCap className="size-5" />
            </span>
            TPassist
          </Link>
          <AiStatus />
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
