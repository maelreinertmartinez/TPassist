import { useMutation } from '@tanstack/react-query';
import type { JobDto, JobType } from '@tpassist/shared';
import { CheckCircle2, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { Card, ProgressBar } from './ui';

const LABELS: Record<JobType, string> = {
  ingest: 'Analyse d’un PDF',
  link_corrections: 'Rattachement des corrigés',
  report: 'Bilan de séance',
  quiz: 'Génération d’un quiz',
  generate_ei: 'Génération d’une EI blanche',
};

export function JobList({ jobs, documentsById, onChange }: { jobs: JobDto[]; documentsById: Map<string, string>; onChange: () => void }) {
  const retry = useMutation({ mutationFn: (id: string) => api.post(`/api/jobs/${id}/retry`), onSuccess: onChange });
  if (jobs.length === 0) return null;
  return (
    <Card className="divide-y divide-border">
      {jobs.map((j) => (
        <div key={j.id} className="space-y-2 px-4 py-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {j.status === 'done' ? (
                <CheckCircle2 className="size-4 shrink-0 text-ok" />
              ) : j.status === 'error' ? (
                <XCircle className="size-4 shrink-0 text-bad" />
              ) : (
                <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
              )}
              <span className="truncate font-medium">
                {LABELS[j.type]}
                {j.type === 'ingest' && j.refId && documentsById.get(j.refId) ? ` — ${documentsById.get(j.refId)}` : ''}
              </span>
            </span>
            {j.status === 'error' && (
              <button className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => retry.mutate(j.id)}>
                <RotateCcw className="size-3.5" /> Relancer
              </button>
            )}
          </div>
          {(j.status === 'running' || j.status === 'queued') && <ProgressBar value={j.progress} />}
          <p className={`text-xs ${j.status === 'error' ? 'text-bad' : 'text-muted'}`}>{j.status === 'error' ? j.error : j.message}</p>
        </div>
      ))}
    </Card>
  );
}
