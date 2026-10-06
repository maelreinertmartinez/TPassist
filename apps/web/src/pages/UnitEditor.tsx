import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UNIT_KIND_LABELS, type EditorExercise, type EditorQuestion, type EditorSection, type EditorUnit, type UnitKind } from '@tpassist/shared';
import clsx from 'clsx';
import { CheckCircle2, Combine, Eye, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { Button, Callout, ErrorBox, Field, IconButton, inlineInputClass, inputClass, Modal, Segmented, Spinner, Tag, Toggle, useConfirm } from '../components/ui';
import { api } from '../lib/api';
import { useBreadcrumbs } from '../lib/breadcrumbs';

type OnSaved = (d: EditorUnit) => void;

export function UnitEditor() {
  const { unitId } = useParams<{ unitId: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const key = ['editor', unitId];
  const ed = useQuery({ queryKey: key, queryFn: () => api.get<EditorUnit>(`/api/units/${unitId}/editor`) });
  const course = useQuery({
    queryKey: ['course-name', ed.data?.unit.courseId],
    queryFn: () => api.get<{ course: { name: string } }>(`/api/courses/${ed.data!.unit.courseId}`),
    enabled: Boolean(ed.data),
  });
  useBreadcrumbs(ed.data ? [{ label: course.data?.course.name ?? 'Cours', to: `/courses/${ed.data.unit.courseId}` }, { label: `Structure · ${ed.data.unit.title}` }] : []);
  const set: OnSaved = (d) => qc.setQueryData(key, d);
  const [mergeOpen, setMergeOpen] = useState(false);

  const removeUnit = useMutation({
    mutationFn: () => api.del(`/api/units/${unitId}`),
    onSuccess: () => navigate(`/courses/${ed.data?.unit.courseId}`),
  });

  if (ed.isLoading) return <Page><Spinner label="Chargement…" /></Page>;
  if (ed.error || !ed.data) return <Page><ErrorBox error={ed.error ?? 'Partie introuvable'} /></Page>;
  const { unit } = ed.data;

  return (
    <Page>
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

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-3xl px-4 pt-12 pb-24 sm:px-6">{children}</div>;
}

/** Petit indicateur de sauvegarde automatique. */
function SaveState({ pending, error }: { pending: boolean; error: unknown }) {
  if (error) return <span className="text-xs text-red-600">Non enregistré : {error instanceof Error ? error.message : String(error)}</span>;
  if (pending) return <span className="text-xs text-ink-3">Enregistrement…</span>;
  return null;
}

const EXERCISE_KINDS: UnitKind[] = ['td', 'tp', 'ei'];

function UnitHeader({ data, onSaved, actions }: { data: EditorUnit; onSaved: OnSaved; actions: ReactNode }) {
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
          {EXERCISE_KINDS.includes(unit.kind) && (
            <Segmented
              value={unit.kind}
              onChange={(kind) => save.mutate({ kind })}
              items={EXERCISE_KINDS.map((k) => ({ value: k, label: UNIT_KIND_LABELS[k] }))}
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

/** Champ Markdown édité en place, avec aperçu, enregistré quand on quitte le champ. */
function MdField({ label, value, onCommit, rows = 3, placeholder }: { label?: string; value: string; onCommit: (v: string) => void; rows?: number; placeholder?: string }) {
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

function ExerciseEditor({ ex, onSaved }: { ex: EditorExercise; onSaved: OnSaved }) {
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

function AddExerciseButton({ unitId, onSaved }: { unitId: string; onSaved: OnSaved }) {
  const add = useMutation({ mutationFn: () => api.post<EditorUnit>(`/api/units/${unitId}/exercises`), onSuccess: onSaved });
  return (
    <Button icon={<Plus className="size-4" />} loading={add.isPending} onClick={() => add.mutate()}>
      Ajouter un exercice
    </Button>
  );
}

function SectionEditor({ section, onSaved }: { section: EditorSection; onSaved: OnSaved }) {
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

function CorrigeEditor({ data, onSaved }: { data: EditorUnit; onSaved: OnSaved }) {
  const solutions = data.unit.meta.solutions ?? [];
  const targets = data.siblings.filter((s) => EXERCISE_KINDS.includes(s.kind));
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

function MergeModal({ data, open, onClose, onSaved }: { data: EditorUnit; open: boolean; onClose: () => void; onSaved: OnSaved }) {
  const isCours = data.unit.kind === 'cours';
  const candidates = data.siblings.filter((s) => (isCours ? s.kind === 'cours' : EXERCISE_KINDS.includes(s.kind)));
  const [source, setSource] = useState('');
  const merge = useMutation({
    mutationFn: () => api.post<EditorUnit>(`/api/units/${data.unit.id}/merge`, { sourceId: source }),
    onSuccess: (d) => {
      onSaved(d);
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Fusionner une autre partie ici"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!source} loading={merge.isPending} onClick={() => merge.mutate()}>
            Fusionner
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          Les {isCours ? 'sections' : 'exercices'} de la partie choisie sont ajoutés à la fin de « {data.unit.title} », puis la partie choisie est supprimée.
        </p>
        <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Partie à fusionner">
          <option value="">Choisir une partie</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {UNIT_KIND_LABELS[c.kind]} · {c.title}
            </option>
          ))}
        </select>
        <ErrorBox error={merge.error} />
      </div>
    </Modal>
  );
}
