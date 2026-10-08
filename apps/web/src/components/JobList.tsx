// Tâches de fond d'un cours (analyse des PDF, générations…) en cours ou en échec, avec relance.
import { useMutation } from '@tanstack/react-query';
import type { JobDto, JobType } from '@tpassist/shared';
import { Loader2, RotateCcw, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Callout, ProgressBar } from './ui';

const LABELS: Record<JobType, string> = {
  ingest: 'Analyse',
  extract_unit: 'Ajout manuel',
  link_corrections: 'Rattachement des corrigés',
  report: 'Bilan de séance',
  quiz: 'Génération d’un quiz',
  generate_ei: 'Génération d’une EI blanche',
  notions: 'Carte des notions',
};

/** Tâches en cours ou en échec, affichées en encadrés (les tâches terminées disparaissent). */
export function JobList({ jobs, documentsById, onChange }: { jobs: JobDto[]; documentsById: Map<string, string>; onChange: () => void }) {
  const retry = useMutation({ mutationFn: (id: string) => api.post(`/api/jobs/${id}/retry`), onSuccess: onChange });
  const visible = jobs.filter((j) => j.status !== 'done');
  if (visible.length === 0) return null;
  return (
    <div className="space-y-2">
      {visible.map((j) => {
        // Analyse et ajout manuel portent sur un document : on le nomme.
        const docName = (j.type === 'ingest' || j.type === 'extract_unit') && j.refId ? documentsById.get(j.refId) : undefined;
        const title = `${LABELS[j.type]}${docName ? ` ${j.type === 'ingest' ? 'de' : 'dans'} « ${docName} »` : ''}`;
        return j.status === 'error' ? (
          <Callout
            key={j.id}
            tone="red"
            icon={<XCircle className="size-4" />}
            title={`${title} : échec`}
            aside={
              <Button size="sm" variant="raised" icon={<RotateCcw className="size-4" />} loading={retry.isPending && retry.variables === j.id} onClick={() => retry.mutate(j.id)}>
                Relancer
              </Button>
            }
          >
            <p className="text-sm">{j.error}</p>
          </Callout>
        ) : (
          <Callout key={j.id} tone="blue" icon={<Loader2 className="size-4 animate-spin" />} title={title}>
            <p className="mb-2 text-sm">{j.message}</p>
            <ProgressBar value={j.progress} onTint />
          </Callout>
        );
      })}
    </div>
  );
}
