import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UNIT_KIND_LABELS, type EditorExercise, type EditorQuestion, type EditorSection, type EditorUnit, type UnitKind } from '@tpassist/shared';
import { ArrowLeft, CheckCircle2, Combine, Eye, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { Badge, Button, Card, ErrorBox, Field, inputClass, Modal, Spinner } from '../components/ui';
import { api } from '../lib/api';

export function UnitEditor() {
  const { unitId } = useParams<{ unitId: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = ['editor', unitId];
  const ed = useQuery({ queryKey: key, queryFn: () => api.get<EditorUnit>(`/api/units/${unitId}/editor`) });
  const set = (d: EditorUnit) => qc.setQueryData(key, d);
  const [mergeOpen, setMergeOpen] = useState(false);

  const removeUnit = useMutation({
    mutationFn: () => api.del(`/api/units/${unitId}`),
    onSuccess: () => navigate(`/courses/${ed.data?.unit.courseId}`),
  });

  if (ed.isLoading) return <div className="p-8"><Spinner label="Chargement…" /></div>;
  if (ed.error || !ed.data) return <div className="p-8"><ErrorBox error={ed.error ?? 'Partie introuvable'} /></div>;
  const { unit } = ed.data;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <Link to={`/courses/${unit.courseId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Retour au cours
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Éditeur de structure</p>
          <h1 className="text-xl font-semibold">{unit.title}</h1>
          {unit.documentName && (
            <p className="mt-1 text-xs text-muted">
              {unit.documentName} · pages {unit.pageStart}–{unit.pageEnd}{' '}
              <a className="text-accent hover:underline" href={`/api/documents/${unit.documentId}/file#page=${unit.pageStart}`} target="_blank" rel="noreferrer">
                ouvrir le PDF
              </a>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {unit.kind !== 'corrige' && (
            <Button icon={<Combine className="size-4" />} onClick={() => setMergeOpen(true)}>
              Fusionner…
            </Button>
          )}
          <Button
            variant="danger"
            icon={<Trash2 className="size-4" />}
            loading={removeUnit.isPending}
            onClick={() => confirm('Supprimer cette partie (et les sessions associées) ?') && removeUnit.mutate()}
          >
            Supprimer
          </Button>
        </div>
      </div>

      <UnitMetaForm data={ed.data} onSaved={set} />

      {unit.kind === 'corrige' ? (
        <CorrigeEditor data={ed.data} onSaved={set} />
      ) : unit.kind === 'cours' ? (
        <div className="mt-6 space-y-3">
          {ed.data.sections.map((s) => (
            <SectionEditor key={s.id} section={s} onSaved={set} />
          ))}
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {ed.data.exercises.map((ex) => (
            <ExerciseEditor key={ex.id} ex={ex} onSaved={set} />
          ))}
          <AddExerciseButton unitId={unit.id} onSaved={set} />
        </div>
      )}

      <MergeModal data={ed.data} open={mergeOpen} onClose={() => setMergeOpen(false)} onSaved={set} />
    </div>
  );
}

function UnitMetaForm({ data, onSaved }: { data: EditorUnit; onSaved: (d: EditorUnit) => void }) {
  const { unit } = data;
  const [title, setTitle] = useState(unit.title);
  const [kind, setKind] = useState<UnitKind>(unit.kind);
  const [duration, setDuration] = useState<string>(unit.meta.durationMinutes ? String(unit.meta.durationMinutes) : '');
  useEffect(() => {
    setTitle(unit.title);
    setKind(unit.kind);
  }, [unit.id]);
  const save = useMutation({
    mutationFn: () =>
      api.patch<EditorUnit>(`/api/units/${unit.id}`, {
        title,
        kind,
        ...(kind === 'ei' ? { durationMinutes: duration ? Number(duration) : null } : {}),
      }),
    onSuccess: onSaved,
  });
  const exerciseKinds: UnitKind[] = ['td', 'tp', 'ei'];
  return (
    <Card className="space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_160px_140px]">
        <Field label="Titre">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Type">
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as UnitKind)} disabled={!exerciseKinds.includes(unit.kind)}>
            {(exerciseKinds.includes(unit.kind) ? exerciseKinds : [unit.kind]).map((k) => (
              <option key={k} value={k}>
                {UNIT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        {kind === 'ei' && (
          <Field label="Durée (min)">
            <input type="number" className={inputClass} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </Field>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <ErrorBox error={save.error} />
        <Button variant="primary" size="sm" className="ml-auto" icon={<Save className="size-3.5" />} loading={save.isPending} onClick={() => save.mutate()}>
          Enregistrer
        </Button>
      </div>
    </Card>
  );
}

function MdField({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <button className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink" onClick={() => setPreview(!preview)}>
          {preview ? <Pencil className="size-3" /> : <Eye className="size-3" />} {preview ? 'Éditer' : 'Aperçu'}
        </button>
      </div>
      {preview ? (
        <div className="min-h-16 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <Markdown className="text-sm">{value || '*(vide)*'}</Markdown>
        </div>
      ) : (
        <textarea rows={rows} className={`${inputClass} font-mono`} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function ExerciseEditor({ ex, onSaved }: { ex: EditorExercise; onSaved: (d: EditorUnit) => void }) {
  const [title, setTitle] = useState(ex.title);
  const [context, setContext] = useState(ex.contextMd);
  const dirty = title !== ex.title || context !== ex.contextMd;
  const save = useMutation({ mutationFn: () => api.patch<EditorUnit>(`/api/exercises/${ex.id}`, { title, contextMd: context }), onSuccess: onSaved });
  const remove = useMutation({ mutationFn: () => api.del<EditorUnit>(`/api/exercises/${ex.id}`), onSuccess: onSaved });
  const add = useMutation({ mutationFn: () => api.post<EditorUnit>(`/api/exercises/${ex.id}/questions`), onSuccess: onSaved });
  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-end gap-3">
        <Field label="Exercice">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <button className="mb-2 rounded p-1.5 text-muted hover:bg-surface-2 hover:text-bad" title="Supprimer l’exercice" onClick={() => confirm('Supprimer cet exercice et ses questions ?') && remove.mutate()}>
          <Trash2 className="size-4" />
        </button>
      </div>
      <MdField label="Énoncé commun (données, valeurs, matrices)" value={context} onChange={setContext} />
      {dirty && (
        <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()} icon={<Save className="size-3.5" />}>
          Enregistrer l’exercice
        </Button>
      )}
      <div className="space-y-3 border-t border-border pt-4">
        {ex.questions.map((q) => (
          <QuestionEditor key={q.id} q={q} onSaved={onSaved} />
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} loading={add.isPending} onClick={() => add.mutate()}>
          Ajouter une question
        </Button>
      </div>
    </Card>
  );
}

function QuestionEditor({ q, onSaved }: { q: EditorQuestion; onSaved: (d: EditorUnit) => void }) {
  const [label, setLabel] = useState(q.label);
  const [statement, setStatement] = useState(q.statementMd);
  const [points, setPoints] = useState(q.points === null ? '' : String(q.points));
  const [figures, setFigures] = useState(q.figurePages.join(', '));
  const [official, setOfficial] = useState(q.officialSolutionMd ?? '');
  const [showOfficial, setShowOfficial] = useState(false);
  const dirty =
    label !== q.label || statement !== q.statementMd || points !== (q.points === null ? '' : String(q.points)) || figures !== q.figurePages.join(', ') || official !== (q.officialSolutionMd ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.patch<EditorUnit>(`/api/questions/${q.id}`, {
        label,
        statementMd: statement,
        points: points === '' ? null : Number(points),
        figurePages: figures
          .split(/[,\s]+/)
          .map((x) => Number(x))
          .filter((n) => Number.isInteger(n) && n > 0),
        officialSolutionMd: official,
      }),
    onSuccess: onSaved,
  });
  const remove = useMutation({ mutationFn: () => api.del<EditorUnit>(`/api/questions/${q.id}`), onSuccess: onSaved });
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-[100px_100px_1fr_auto] sm:items-end">
        <Field label="Numéro">
          <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Points">
          <input className={inputClass} value={points} onChange={(e) => setPoints(e.target.value)} placeholder="—" />
        </Field>
        <Field label="Pages de figures">
          <input className={inputClass} value={figures} onChange={(e) => setFigures(e.target.value)} placeholder="ex. 3, 4" />
        </Field>
        <button className="mb-2 rounded p-1.5 text-muted hover:bg-surface-2 hover:text-bad" title="Supprimer la question" onClick={() => confirm('Supprimer cette question ?') && remove.mutate()}>
          <Trash2 className="size-4" />
        </button>
      </div>
      <MdField label="Énoncé de la question" value={statement} onChange={setStatement} />
      <button className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => setShowOfficial(!showOfficial)}>
        {q.officialSolutionMd ? <CheckCircle2 className="size-3.5 text-ok" /> : <Plus className="size-3.5" />}
        {q.officialSolutionMd ? 'Corrigé officiel associé' : 'Ajouter un corrigé officiel'}
      </button>
      {showOfficial && <MdField label="Corrigé officiel (laisser vide pour le retirer)" value={official} onChange={setOfficial} rows={5} />}
      {dirty && (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()} icon={<Save className="size-3.5" />}>
            Enregistrer la question
          </Button>
          <span className="text-xs text-muted">Les aides déjà générées pour cette question seront recalculées.</span>
        </div>
      )}
      <ErrorBox error={save.error} />
    </div>
  );
}

function AddExerciseButton({ unitId, onSaved }: { unitId: string; onSaved: (d: EditorUnit) => void }) {
  const add = useMutation({ mutationFn: () => api.post<EditorUnit>(`/api/units/${unitId}/exercises`), onSuccess: onSaved });
  return (
    <Button icon={<Plus className="size-4" />} loading={add.isPending} onClick={() => add.mutate()}>
      Ajouter un exercice
    </Button>
  );
}

function SectionEditor({ section, onSaved }: { section: EditorSection; onSaved: (d: EditorUnit) => void }) {
  const [title, setTitle] = useState(section.title);
  const [summary, setSummary] = useState(section.summary);
  const [content, setContent] = useState(section.contentMd);
  const dirty = title !== section.title || summary !== section.summary || content !== section.contentMd;
  const save = useMutation({ mutationFn: () => api.patch<EditorUnit>(`/api/sections/${section.id}`, { title, summary, contentMd: content }), onSuccess: onSaved });
  return (
    <details className="rounded-xl border border-border bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        {section.title} <span className="text-xs font-normal text-muted">p. {section.pageStart}–{section.pageEnd}</span>
      </summary>
      <div className="space-y-3 border-t border-border p-4">
        <Field label="Titre">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Résumé">
          <textarea rows={2} className={inputClass} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <MdField label="Contenu" value={content} onChange={setContent} rows={12} />
        {dirty && (
          <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()} icon={<Save className="size-3.5" />}>
            Enregistrer la section
          </Button>
        )}
      </div>
    </details>
  );
}

function CorrigeEditor({ data, onSaved }: { data: EditorUnit; onSaved: (d: EditorUnit) => void }) {
  const solutions = data.unit.meta.solutions ?? [];
  const targets = data.siblings.filter((s) => ['td', 'tp', 'ei'].includes(s.kind));
  const [target, setTarget] = useState<string>(data.unit.correctsUnitId ?? '');
  const targetEditor = useQuery({ queryKey: ['editor', target], queryFn: () => api.get<EditorUnit>(`/api/units/${target}/editor`), enabled: Boolean(target) });
  const [mapping, setMapping] = useState<Record<number, string>>(() =>
    Object.fromEntries(solutions.map((s, i) => [i, s.matchedQuestionId ?? '']).filter(([, v]) => v)),
  );
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
    <div className="mt-6 space-y-4">
      <Card className="space-y-3 p-4">
        <Field label="Sujet corrigé" hint="Le corrigé sert de référence pour la vérification, l’indice, la solution et le bilan — il n’est jamais affiché d’office.">
          <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">— Non rattaché —</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {UNIT_KIND_LABELS[t.kind]} · {t.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" loading={link.isPending && link.variables === true} onClick={() => link.mutate(true)}>
            Associer automatiquement (par numéros)
          </Button>
          <Button size="sm" loading={link.isPending && link.variables === false} onClick={() => link.mutate(false)}>
            Enregistrer la correspondance ci-dessous
          </Button>
        </div>
        <ErrorBox error={link.error} />
      </Card>
      {solutions.map((s, i) => (
        <Card key={i} className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {s.exerciseLabel} {s.questionLabel && `— ${s.questionLabel}`}
            </p>
            {s.matchedQuestionId ? <Badge tone="ok">Associée</Badge> : <Badge>Non associée</Badge>}
          </div>
          <Markdown className="max-h-48 overflow-auto rounded-lg bg-surface-2 px-3 py-2 text-sm">{s.solutionMd}</Markdown>
          {target && (
            <select className={inputClass} value={mapping[i] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [i]: e.target.value }))}>
              <option value="">— Aucune question —</option>
              {questions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
          )}
        </Card>
      ))}
    </div>
  );
}

function MergeModal({ data, open, onClose, onSaved }: { data: EditorUnit; open: boolean; onClose: () => void; onSaved: (d: EditorUnit) => void }) {
  const isCours = data.unit.kind === 'cours';
  const candidates = data.siblings.filter((s) => (isCours ? s.kind === 'cours' : ['td', 'tp', 'ei'].includes(s.kind)));
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
      title="Fusionner une autre partie dans celle-ci"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!source} loading={merge.isPending} onClick={() => merge.mutate()}>
            Fusionner
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">Les {isCours ? 'sections' : 'exercices'} de la partie choisie seront ajoutés à la fin de « {data.unit.title} », puis la partie choisie sera supprimée.</p>
        <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">— Choisir —</option>
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
