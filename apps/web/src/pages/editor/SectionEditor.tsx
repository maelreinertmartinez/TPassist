// Édition d'une section de chapitre de cours (titre, résumé, contenu).
import { useMutation } from '@tanstack/react-query';
import type { EditorSection, EditorUnit } from '@tpassist/shared';
import clsx from 'clsx';
import { useState } from 'react';
import { inlineInputClass, Toggle } from '../../components/ui';
import { api } from '../../lib/api';
import { MdField, SaveState, type OnSaved } from './common';

/** Une section de cours, dépliable. */
export function SectionEditor({ section, onSaved }: { section: EditorSection; onSaved: OnSaved }) {
  const [title, setTitle] = useState(section.title);
  const [summary, setSummary] = useState(section.summary);
  const save = useMutation({ mutationFn: (patch: Record<string, unknown>) => api.patch<EditorUnit>(`/api/sections/${section.id}`, patch), onSuccess: onSaved });
  return (
    <Toggle
      summary={
        <span>
          {section.title} <span className="text-ink-3">· p. {section.pageStart}–{section.pageEnd}</span>
        </span>
      }
    >
      <div className="space-y-4 pb-6">
        <input className={clsx(inlineInputClass, '-ml-2 text-lg font-semibold')} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== section.title && save.mutate({ title })} />
        <div>
          <span className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Résumé</span>
          <textarea rows={2} className={clsx(inlineInputClass, 'text-sm leading-6')} value={summary} onChange={(e) => setSummary(e.target.value)} onBlur={() => summary !== section.summary && save.mutate({ summary })} />
        </div>
        <MdField label="Contenu" value={section.contentMd} rows={12} onCommit={(contentMd) => save.mutate({ contentMd })} />
        <SaveState pending={save.isPending} error={save.error} />
      </div>
    </Toggle>
  );
}
