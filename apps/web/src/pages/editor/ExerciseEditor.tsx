// Édition d'un TD, TP ou EI : exercices (titre, énoncé commun) et questions (énoncé, barème, figures, corrigé).
import { useMutation } from '@tanstack/react-query';
import type { EditorExercise, EditorQuestion, EditorUnit } from '@tpassist/shared';
import clsx from 'clsx';
import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Field, IconButton, inlineInputClass, inputClass, Tag, Toggle, useConfirm } from '../../components/ui';
import { api } from '../../lib/api';
import { MdField, SaveState, type OnSaved } from './common';

/** Un exercice : titre, énoncé commun et questions. */
export function ExerciseEditor({ ex, onSaved }: { ex: EditorExercise; onSaved: OnSaved }) {
  const confirm = useConfirm();
  const [title, setTitle] = useState(ex.title);
  useEffect(() => setTitle(ex.title), [ex.title]);
  const save = useMutation({ mutationFn: (patch: { title?: string; contextMd?: string }) => api.patch<EditorUnit>(`/api/exercises/${ex.id}`, patch), onSuccess: onSaved });
  const remove = useMutation({ mutationFn: () => api.del<EditorUnit>(`/api/exercises/${ex.id}`), onSuccess: onSaved });
  const add = useMutation({ mutationFn: () => api.post<EditorUnit>(`/api/exercises/${ex.id}/questions`), onSuccess: onSaved });
  return (
    <section className="space-y-4">
      <div className="group flex items-center gap-2">
        <input
          aria-label="Titre de l’exercice"
          className={clsx(inlineInputClass, '-ml-2 text-xl font-semibold tracking-tight')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== ex.title && save.mutate({ title })}
        />
        <SaveState pending={save.isPending} error={save.error} />
        <IconButton
          label="Supprimer l’exercice"
          onClick={async () => {
            if (await confirm({ title: `Supprimer « ${ex.title} » ?`, message: `Ses ${ex.questions.length} question(s) seront supprimées.`, confirmLabel: 'Supprimer', danger: true })) remove.mutate();
          }}
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      <MdField label="Énoncé commun" value={ex.contextMd} onCommit={(contextMd) => save.mutate({ contextMd })} placeholder="Données de l’exercice : valeurs, matrices…" />
      <div className="space-y-1">
        {ex.questions.map((q) => (
          <QuestionEditor key={q.id} q={q} onSaved={onSaved} />
        ))}
      </div>
      <Button size="sm" variant="tertiary" icon={<Plus className="size-4" />} loading={add.isPending} onClick={() => add.mutate()}>
        Ajouter une question
      </Button>
    </section>
  );
}

/** Une question : énoncé, barème, pages des figures et corrigé officiel. */
function QuestionEditor({ q, onSaved }: { q: EditorQuestion; onSaved: OnSaved }) {
  const confirm = useConfirm();
  const [label, setLabel] = useState(q.label);
  const [points, setPoints] = useState(q.points === null ? '' : String(q.points));
  const [figures, setFigures] = useState(q.figurePages.join(', '));
  useEffect(() => {
    setLabel(q.label);
    setPoints(q.points === null ? '' : String(q.points));
    setFigures(q.figurePages.join(', '));
  }, [q.label, q.points, q.figurePages.join(',')]);
  const save = useMutation({ mutationFn: (patch: Record<string, unknown>) => api.patch<EditorUnit>(`/api/questions/${q.id}`, patch), onSuccess: onSaved });
  const remove = useMutation({ mutationFn: () => api.del<EditorUnit>(`/api/questions/${q.id}`), onSuccess: onSaved });
  return (
    <Toggle
      summary={
        <span className="flex items-center justify-between gap-2">
          <span className="truncate">
            <span className="font-semibold">Question {q.label}</span> <span className="text-ink-3">· {q.statementMd.replace(/\s+/g, ' ').slice(0, 80)}</span>
          </span>
          {q.officialSolutionMd && (
            <Tag tone="green">
              <CheckCircle2 className="size-3" /> Corrigé
            </Tag>
          )}
        </span>
      }
    >
      <div className="space-y-4 pb-6">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Numéro">
            <input className={clsx(inputClass, 'w-24')} value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== q.label && save.mutate({ label })} />
          </Field>
          <Field label="Points">
            <input
              className={clsx(inputClass, 'w-24')}
              value={points}
              placeholder="—"
              onChange={(e) => setPoints(e.target.value)}
              onBlur={() => points !== (q.points === null ? '' : String(q.points)) && save.mutate({ points: points === '' ? null : Number(points) })}
            />
          </Field>
          <Field label="Pages de figures">
            <input
              className={clsx(inputClass, 'w-32')}
              value={figures}
              placeholder="ex. 3, 4"
              onChange={(e) => setFigures(e.target.value)}
              onBlur={() =>
                figures !== q.figurePages.join(', ') &&
                save.mutate({
                  figurePages: figures
                    .split(/[,\s]+/)
                    .map(Number)
                    .filter((n) => Number.isInteger(n) && n > 0),
                })
              }
            />
          </Field>
          <SaveState pending={save.isPending} error={save.error} />
        </div>
        <MdField label="Énoncé" value={q.statementMd} rows={4} onCommit={(statementMd) => save.mutate({ statementMd })} />
        <MdField
          label="Corrigé officiel"
          value={q.officialSolutionMd ?? ''}
          rows={3}
          placeholder="Optionnel : colle ici la correction officielle de cette question."
          onCommit={(officialSolutionMd) => save.mutate({ officialSolutionMd })}
        />
        <p className="text-xs text-ink-3">Modifier l’énoncé ou le corrigé recalcule les aides déjà générées pour cette question.</p>
        <Button
          size="sm"
          variant="danger-quiet"
          icon={<Trash2 className="size-4" />}
          onClick={async () => {
            if (await confirm({ title: `Supprimer la question ${q.label} ?`, message: 'Ses réponses et aides enregistrées seront aussi supprimées.', confirmLabel: 'Supprimer', danger: true })) remove.mutate();
          }}
        >
          Supprimer la question
        </Button>
      </div>
    </Toggle>
  );
}

/** Ajoute un exercice (avec une première question) à la fin de la partie. */
export function AddExerciseButton({ unitId, onSaved }: { unitId: string; onSaved: OnSaved }) {
  const add = useMutation({ mutationFn: () => api.post<EditorUnit>(`/api/units/${unitId}/exercises`), onSuccess: onSaved });
  return (
    <Button icon={<Plus className="size-4" />} loading={add.isPending} onClick={() => add.mutate()}>
      Ajouter un exercice
    </Button>
  );
}
