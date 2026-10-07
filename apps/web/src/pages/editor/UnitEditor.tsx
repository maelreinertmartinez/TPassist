// Éditeur de structure d'une partie (chapitre, TD, TP, EI ou corrigé) : corrige à la main ce que l'IA a extrait.
// Chaque champ est enregistré quand on le quitte ; le serveur renvoie l'unité à jour.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EditorUnit } from '@tpassist/shared';
import { Combine, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, ErrorBox, Page, Spinner, useConfirm } from '../../components/ui';
import { api } from '../../lib/api';
import { useBreadcrumbs } from '../../lib/breadcrumbs';
import type { OnSaved } from './common';
import { CorrigeEditor } from './CorrigeEditor';
import { AddExerciseButton, ExerciseEditor } from './ExerciseEditor';
import { MergeModal } from './MergeModal';
import { SectionEditor } from './SectionEditor';
import { UnitHeader } from './UnitHeader';

/** Éditeur de structure (route /units/:unitId/edit). */
export function UnitEditor() {
  const { unitId } = useParams<{ unitId: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const key = ['editor', unitId];
  const ed = useQuery({ queryKey: key, queryFn: () => api.get<EditorUnit>(`/api/units/${unitId}/editor`) });
  useBreadcrumbs(ed.data ? [{ label: ed.data.courseName, to: `/courses/${ed.data.unit.courseId}` }, { label: `Structure · ${ed.data.unit.title}` }] : []);
  const set: OnSaved = (d) => qc.setQueryData(key, d);
  const [mergeOpen, setMergeOpen] = useState(false);

  const removeUnit = useMutation({
    mutationFn: () => api.del(`/api/units/${unitId}`),
    onSuccess: () => navigate(`/courses/${ed.data?.unit.courseId}`),
  });

  if (ed.isLoading) return <Page width="document"><Spinner label="Chargement…" /></Page>;
  if (ed.error || !ed.data) return <Page width="document"><ErrorBox error={ed.error ?? 'Partie introuvable'} /></Page>;
  const { unit } = ed.data;

  return (
    <Page width="document">
      <UnitHeader
        data={ed.data}
        onSaved={set}
        actions={
          <>
            {unit.kind !== 'corrige' && (
              <Button variant="tertiary" icon={<Combine className="size-4" />} onClick={() => setMergeOpen(true)}>
                Fusionner…
              </Button>
            )}
            <Button
              variant="danger-quiet"
              icon={<Trash2 className="size-4" />}
              loading={removeUnit.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: `Supprimer « ${unit.title} » ?`,
                    message: 'Cette partie, ses questions et les séances associées seront supprimées. Le PDF reste disponible pour une nouvelle analyse.',
                    confirmLabel: 'Supprimer la partie',
                    danger: true,
                  })
                )
                  removeUnit.mutate();
              }}
            >
              Supprimer
            </Button>
          </>
        }
      />

      {unit.kind === 'corrige' ? (
        <CorrigeEditor data={ed.data} onSaved={set} />
      ) : unit.kind === 'cours' ? (
        <div className="space-y-1">
          {ed.data.sections.map((s) => (
            <SectionEditor key={s.id} section={s} onSaved={set} />
          ))}
        </div>
      ) : (
        <div className="space-y-12">
          {ed.data.exercises.map((ex) => (
            <ExerciseEditor key={ex.id} ex={ex} onSaved={set} />
          ))}
          <AddExerciseButton unitId={unit.id} onSaved={set} />
        </div>
      )}

      <MergeModal data={ed.data} open={mergeOpen} onClose={() => setMergeOpen(false)} onSaved={set} />
    </Page>
  );
}
