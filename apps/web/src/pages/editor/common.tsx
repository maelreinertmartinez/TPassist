// Éléments communs de l'éditeur de structure : enregistrement automatique et champ Markdown édité en place.
import type { EditorUnit } from '@tpassist/shared';
import clsx from 'clsx';
import { Eye, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Markdown } from '../../components/Markdown';
import { IconButton, inlineInputClass } from '../../components/ui';
import { errorMessage } from '../../lib/api';

/** Chaque modification renvoie l'unité complète, à jour : elle remplace celle en cache. */
export type OnSaved = (d: EditorUnit) => void;

/** Petit indicateur de sauvegarde automatique. */
export function SaveState({ pending, error }: { pending: boolean; error: unknown }) {
  if (error) return <span className="text-xs text-red-600">Non enregistré : {errorMessage(error)}</span>;
  if (pending) return <span className="text-xs text-ink-3">Enregistrement…</span>;
  return null;
}

/** Champ Markdown édité en place, avec aperçu, enregistré quand on quitte le champ. */
export function MdField({ label, value, onCommit, rows = 3, placeholder }: { label?: string; value: string; onCommit: (v: string) => void; rows?: number; placeholder?: string }) {
  const [text, setText] = useState(value);
  const [preview, setPreview] = useState(false);
  useEffect(() => setText(value), [value]);
  return (
    <div>
      <div className="mb-1 flex min-h-8 items-center justify-between">
        {label && <span className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{label}</span>}
        <IconButton label={preview ? 'Éditer' : 'Aperçu'} onClick={() => setPreview(!preview)} active={preview} className="ml-auto">
          {preview ? <Pencil className="size-4" /> : <Eye className="size-4" />}
        </IconButton>
      </div>
      {preview ? (
        <div className="rounded px-2 py-1">
          <Markdown className="text-sm">{text || '*(vide)*'}</Markdown>
        </div>
      ) : (
        <textarea
          rows={rows}
          className={clsx(inlineInputClass, 'resize-y font-mono text-sm leading-6')}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== value && onCommit(text)}
        />
      )}
    </div>
  );
}
