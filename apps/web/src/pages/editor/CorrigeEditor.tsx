// Rattachement d'un corrigé à son sujet, et correspondance solution par solution avec les questions.
import { useMutation, useQuery } from '@tanstack/react-query';
import { UNIT_KIND_LABELS, isPlayableKind, type EditorUnit } from '@tpassist/shared';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Markdown } from '../../components/Markdown';
import { Button, Callout, ErrorBox, Field, inputClass, Tag } from '../../components/ui';
import { api } from '../../lib/api';
import type { OnSaved } from './common';

/** Choix du sujet corrigé et correspondance de chaque solution avec une question. */
export function CorrigeEditor({ data, onSaved }: { data: EditorUnit; onSaved: OnSaved }) {
  const solutions = data.unit.meta.solutions ?? [];
  const targets = data.siblings.filter((s) => isPlayableKind(s.kind));
  const [target, setTarget] = useState<string>(data.unit.correctsUnitId ?? '');
  const targetEditor = useQuery({ queryKey: ['editor', target], queryFn: () => api.get<EditorUnit>(`/api/units/${target}/editor`), enabled: Boolean(target) });
  const [mapping, setMapping] = useState<Record<number, string>>(() => Object.fromEntries(solutions.map((s, i) => [i, s.matchedQuestionId ?? '']).filter(([, v]) => v)));
  const link = useMutation({
    mutationFn: (auto: boolean) =>
      api.post<EditorUnit>(`/api/units/${data.unit.id}/link-corrige`, {
        targetUnitId: target || null,
        matches: auto
          ? undefined
          : Object.entries(mapping)
              .filter(([, q]) => q)
              .map(([i, q]) => ({ solutionIndex: Number(i), questionId: q })),
      }),
    onSuccess: (d) => {
      onSaved(d);
      setMapping(Object.fromEntries((d.unit.meta.solutions ?? []).map((s, i) => [i, s.matchedQuestionId ?? '']).filter(([, v]) => v)));
    },
  });
  const questions = targetEditor.data?.exercises.flatMap((e) => e.questions.map((q) => ({ id: q.id, label: `${e.title} — ${q.label}` }))) ?? [];

  return (
    <div className="space-y-8">
      <Callout tone="blue" icon={<CheckCircle2 className="size-4" />}>
        <p className="text-sm">Un corrigé n’est jamais affiché d’office : il sert de référence pour vérifier tes réponses, rédiger l’indication, la solution et le bilan.</p>
      </Callout>
      <div className="space-y-4">
        <Field label="Sujet corrigé">
          <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Non rattaché</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {UNIT_KIND_LABELS[t.kind]} · {t.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={link.isPending && link.variables === true} onClick={() => link.mutate(true)}>
            Associer automatiquement
          </Button>
          <Button loading={link.isPending && link.variables === false} onClick={() => link.mutate(false)}>
            Enregistrer ma correspondance
          </Button>
        </div>
        <ErrorBox error={link.error} />
      </div>
      <div className="space-y-6">
        {solutions.map((s, i) => (
          <div key={i} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {s.exerciseLabel} {s.questionLabel && <span className="text-ink-3">· {s.questionLabel}</span>}
              </p>
              {s.matchedQuestionId ? (
                <Tag tone="green">
                  <CheckCircle2 className="size-3" /> Associée
                </Tag>
              ) : (
                <Tag>Non associée</Tag>
              )}
            </div>
            <div className="max-h-48 overflow-auto rounded-lg bg-block px-4 py-3">
              <Markdown className="text-sm">{s.solutionMd}</Markdown>
            </div>
            {target && (
              <select className={inputClass} value={mapping[i] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [i]: e.target.value }))} aria-label="Question correspondante">
                <option value="">Aucune question</option>
                {questions.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
