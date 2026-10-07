// Onglet « Points bloquants » : liste des notions difficiles du cours, avec leur priorité et leur gestion à la main.
import { useMutation } from '@tanstack/react-query';
import type { WeakPointDto, WeakPointStatus } from '@tpassist/shared';
import { CheckCheck, CheckCircle2, Flame, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { Markdown } from './Markdown';
import { Button, EmptyState, Segmented, Tag, Toggle, useConfirm, type Tone } from './ui';

const STATUS: Record<WeakPointStatus, { label: string; tone: Tone }> = {
  active: { label: 'À travailler', tone: 'yellow' },
  mastered: { label: 'Maîtrisé', tone: 'green' },
  resolved: { label: 'Résolu', tone: 'grey' },
};

function priorityLabel(p: number) {
  return p >= 70 ? 'priorité haute' : p >= 40 ? 'priorité moyenne' : 'priorité basse';
}

/** @param onChange appelé après chaque modification (pour recharger la page du cours) */
export function WeakPointsPanel({ points, onChange }: { points: WeakPointDto[]; onChange: () => void }) {
  const confirm = useConfirm();
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WeakPointStatus }) => api.patch(`/api/weak-points/${id}`, { status }),
    onSuccess: onChange,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/weak-points/${id}`), onSuccess: onChange });
  const active = points.filter((p) => p.status === 'active');
  const list = filter === 'active' ? active : points;

  if (points.length === 0) {
    return (
      <EmptyState icon={<Flame className="size-6" />} title="Aucun point bloquant">
        Ils sont détectés dans les bilans de TD, TP et EI, puis travaillés en priorité dans les quiz et les EI blanches générées.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <Segmented
        value={filter}
        onChange={setFilter}
        items={[
          { value: 'active', label: `À travailler (${active.length})` },
          { value: 'all', label: `Tous (${points.length})` },
        ]}
      />
      {list.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-3">
          <CheckCircle2 className="size-4 text-green-600" /> Rien à travailler pour l’instant.
        </p>
      ) : (
        <div className="space-y-1">
          {list.map((p) => (
            <Toggle
              key={p.id}
              summary={
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{p.notion}</span>
                  <span className="flex items-center gap-2">
                    {p.status === 'active' && <span className="text-xs text-ink-3">{priorityLabel(p.priority)}</span>}
                    <Tag tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Tag>
                  </span>
                </span>
              }
            >
              <div className="space-y-3 pb-4 text-sm">
                {p.descriptionMd && <Markdown className="text-ink-2">{p.descriptionMd}</Markdown>}
                {p.status === 'active' && p.successStreak > 0 && <p className="text-ink-3">{p.successStreak} réussite(s) d’affilée — encore une pour le maîtriser.</p>}
                {p.sections.length > 0 && <p className="text-ink-3">Cours lié : {p.sections.map((s) => s.title).join(' · ')}</p>}
                {p.sourceQuestions.length > 0 && <p className="text-ink-3">Repéré dans : {p.sourceQuestions.map((q) => `${q.unitTitle}, Q${q.label}`).join(' · ')}</p>}
                <div className="flex flex-wrap gap-1">
                  {p.status === 'active' ? (
                    <Button size="sm" variant="tertiary" icon={<CheckCheck className="size-4" />} onClick={() => setStatus.mutate({ id: p.id, status: 'resolved' })}>
                      Marquer résolu
                    </Button>
                  ) : (
                    <Button size="sm" variant="tertiary" icon={<RotateCcw className="size-4" />} onClick={() => setStatus.mutate({ id: p.id, status: 'active' })}>
                      Réactiver
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="danger-quiet"
                    icon={<Trash2 className="size-4" />}
                    onClick={async () => {
                      if (await confirm({ title: 'Supprimer ce point bloquant ?', message: `« ${p.notion} » ne sera plus priorisé dans les quiz et les EI.`, confirmLabel: 'Supprimer', danger: true }))
                        remove.mutate(p.id);
                    }}
                  >
                    Supprimer
                  </Button>
                </div>
              </div>
            </Toggle>
          ))}
        </div>
      )}
    </div>
  );
}
