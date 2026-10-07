// En-tête de l'éditeur : titre, type (entre TD, TP et EI), pages et durée d'une EI, enregistrés au fil de l'eau.
import { PLAYABLE_KINDS, UNIT_KIND_LABELS, isPlayableKind, type EditorUnit } from '@tpassist/shared';
import clsx from 'clsx';
import { FileText } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { inlineInputClass, inputClass, Segmented } from '../../components/ui';
import { api } from '../../lib/api';
import { SaveState, type OnSaved } from './common';

/** @param actions boutons affichés à droite (fusionner, supprimer) */
export function UnitHeader({ data, onSaved, actions }: { data: EditorUnit; onSaved: OnSaved; actions: ReactNode }) {
  const { unit } = data;
  const [title, setTitle] = useState(unit.title);
  const [duration, setDuration] = useState(unit.meta.durationMinutes ? String(unit.meta.durationMinutes) : '');
  useEffect(() => setTitle(unit.title), [unit.id, unit.title]);
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<EditorUnit>(`/api/units/${unit.id}`, patch),
    onSuccess: onSaved,
  });
  return (
    <header className="mb-12">
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
        Structure · {UNIT_KIND_LABELS[unit.kind]}
        {unit.documentName && (
          <>
            {' · '}
            <a className="inline-flex items-center gap-1 hover:text-ink hover:underline" href={`/api/documents/${unit.documentId}/file#page=${unit.pageStart}`} target="_blank" rel="noreferrer">
              <FileText className="size-4" /> {unit.documentName}, p. {unit.pageStart}–{unit.pageEnd}
            </a>
          </>
        )}
      </p>
      <input
        aria-label="Titre"
        className={clsx(inlineInputClass, '-ml-2 mt-2 text-3xl font-semibold tracking-tight')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== unit.title && save.mutate({ title })}
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          {isPlayableKind(unit.kind) && (
            <Segmented
              value={unit.kind}
              onChange={(kind) => save.mutate({ kind })}
              items={PLAYABLE_KINDS.map((k) => ({ value: k, label: UNIT_KIND_LABELS[k] }))}
            />
          )}
          {unit.kind === 'ei' && (
            <label className="flex items-center gap-2 text-sm text-ink-3">
              Durée
              <input
                type="number"
                className={clsx(inputClass, 'w-24')}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                onBlur={() => save.mutate({ durationMinutes: duration ? Number(duration) : null })}
              />
              min
            </label>
          )}
          <SaveState pending={save.isPending} error={save.error} />
        </div>
        <div className="flex gap-1">{actions}</div>
      </div>
    </header>
  );
}
