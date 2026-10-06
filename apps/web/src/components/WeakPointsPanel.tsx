import { useMutation } from '@tanstack/react-query';
import type { WeakPointDto, WeakPointStatus } from '@tpassist/shared';
import clsx from 'clsx';
import { ChevronDown, Flame, RotateCcw, Trash2, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { Markdown } from './Markdown';
import { Badge, Card, EmptyState, Tabs } from './ui';

const STATUS_LABEL: Record<WeakPointStatus, string> = { active: 'Actif', mastered: 'Maîtrisé', resolved: 'Résolu' };

export function WeakPointsPanel({ points, onChange }: { points: WeakPointDto[]; onChange: () => void }) {
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [openId, setOpenId] = useState<string | null>(null);
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WeakPointStatus }) => api.patch(`/api/weak-points/${id}`, { status }),
    onSuccess: onChange,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/weak-points/${id}`), onSuccess: onChange });
  const list = filter === 'active' ? points.filter((p) => p.status === 'active') : points;

  return (
    <div className="space-y-3">
      <Tabs
        value={filter}
        onChange={setFilter}
        items={[
          { value: 'active', label: `Actifs (${points.filter((p) => p.status === 'active').length})` },
          { value: 'all', label: `Tous (${points.length})` },
        ]}
      />
      {list.length === 0 ? (
        <EmptyState icon={<Flame className="size-6" />} title="Aucun point bloquant">
          Ils sont détectés automatiquement dans les bilans de TD, TP et EI, puis priorisés dans les quiz et les EI blanches générées.
        </EmptyState>
      ) : (
        <Card className="divide-y divide-border">
          {list.map((p) => (
            <div key={p.id} className="px-4 py-3">
              <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                <div className="min-w-0 space-y-1.5">
                  <p className="text-sm font-medium">{p.notion}</p>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2" title={`Priorité ${p.priority}/100`}>
                      <div
                        className={clsx('h-full rounded-full', p.priority >= 70 ? 'bg-bad' : p.priority >= 40 ? 'bg-warn' : 'bg-ok')}
                        style={{ width: `${p.priority}%` }}
                      />
                    </div>
                    <Badge tone={p.status === 'active' ? 'warn' : p.status === 'mastered' ? 'ok' : 'neutral'}>{STATUS_LABEL[p.status]}</Badge>
                    {p.successStreak > 0 && p.status === 'active' && <span className="text-xs text-muted">{p.successStreak} réussite(s) d’affilée</span>}
                  </div>
                </div>
                <ChevronDown className={clsx('mt-0.5 size-4 shrink-0 text-muted transition-transform', openId === p.id && 'rotate-180')} />
              </button>
              {openId === p.id && (
                <div className="mt-3 space-y-3 text-sm">
                  {p.descriptionMd && <Markdown className="text-muted">{p.descriptionMd}</Markdown>}
                  {p.sections.length > 0 && (
                    <p className="text-xs text-muted">
                      <span className="font-medium text-ink">Cours lié :</span> {p.sections.map((s) => s.title).join(' · ')}
                    </p>
                  )}
                  {p.sourceQuestions.length > 0 && (
                    <p className="text-xs text-muted">
                      <span className="font-medium text-ink">Apparu dans :</span> {p.sourceQuestions.map((q) => `${q.unitTitle} — Q${q.label}`).join(' · ')}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {p.status === 'active' ? (
                      <button className="inline-flex items-center gap-1 text-xs font-medium text-ok hover:underline" onClick={() => setStatus.mutate({ id: p.id, status: 'resolved' })}>
                        <CheckCheck className="size-3.5" /> Marquer résolu
                      </button>
                    ) : (
                      <button className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => setStatus.mutate({ id: p.id, status: 'active' })}>
                        <RotateCcw className="size-3.5" /> Réactiver
                      </button>
                    )}
                    <button
                      className="inline-flex items-center gap-1 text-xs font-medium text-bad hover:underline"
                      onClick={() => confirm('Supprimer ce point bloquant ?') && remove.mutate(p.id)}
                    >
                      <Trash2 className="size-3.5" /> Supprimer
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
