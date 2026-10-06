import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiHealth, CourseSummary, UsageSummary } from '@tpassist/shared';
import { AlertTriangle, BookOpen, Flame, Play, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Callout, EmptyState, ErrorBox, Field, Modal, Spinner, TextInput } from '../components/ui';
import { api } from '../lib/api';
import { useBreadcrumbs } from '../lib/breadcrumbs';
import { COURSE_COLORS } from '../lib/colors';

function plural(n: number, one: string, many: string) {
  return `${n} ${n > 1 ? many : one}`;
}

function courseMeta(c: CourseSummary) {
  const parts = [
    c.counts.cours && plural(c.counts.cours, 'chapitre', 'chapitres'),
    c.counts.td && `${c.counts.td} TD`,
    c.counts.tp && `${c.counts.tp} TP`,
    c.counts.ei && plural(c.counts.ei, 'EI', 'EI'),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Aucun document pour l’instant';
}

export function Dashboard() {
  useBreadcrumbs([]);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api.get<CourseSummary[]>('/api/courses') });
  const health = useQuery({ queryKey: ['health-ai'], queryFn: () => api.get<AiHealth>('/api/health/ai'), staleTime: 10 * 60 * 1000 });
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api.get<UsageSummary>('/api/usage') });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COURSE_COLORS[0]);

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/courses', { name, color }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['courses'] });
      setOpen(false);
      setName('');
      navigate(`/courses/${c.id}`);
    },
  });

  const hasCourses = Boolean(courses.data?.length);

  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 pb-24 sm:px-6">
      <header className="mb-12 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Mes cours</h1>
          <p className="mt-2 max-w-xl text-ink-3">Importe tes PDF de cours, TD, TP et EI, puis travaille question par question avec l’aide de l’IA.</p>
        </div>
        {hasCourses && (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            Nouveau cours
          </Button>
        )}
      </header>

      {health.data && !health.data.ok && (
        <Callout tone="yellow" icon={<AlertTriangle className="size-4" />} title="L’IA n’est pas disponible" className="mb-8">
          <p className="text-sm">{health.data.message}</p>
        </Callout>
      )}

      {courses.isLoading ? (
        <Spinner label="Chargement…" />
      ) : courses.error ? (
        <ErrorBox error={courses.error} onRetry={() => courses.refetch()} />
      ) : !hasCourses ? (
        <EmptyState
          icon={<BookOpen className="size-6" />}
          title="Crée ton premier cours"
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
              Nouveau cours
            </Button>
          }
        >
          Un cours regroupe tes PDF : l’IA y repère les chapitres, les TD, les TP, les corrigés et les EI.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.data?.map((c) => (
            <Link
              key={c.id}
              to={`/courses/${c.id}`}
              className="group block overflow-hidden rounded-lg bg-raised shadow-e1 transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-accent"
            >
              <div className="h-1" style={{ background: c.color }} />
              <div className="space-y-4 p-6">
                <div className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded text-white" style={{ background: c.color }}>
                    <BookOpen className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-lg leading-tight font-semibold">{c.name}</h2>
                    <p className="mt-1 text-sm text-ink-3">{courseMeta(c)}</p>
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  {c.inProgressSessions > 0 && (
                    <p className="flex items-center gap-2 text-tint-blue-icon">
                      <Play className="size-4" /> {plural(c.inProgressSessions, 'séance en cours', 'séances en cours')}
                    </p>
                  )}
                  {c.activeWeakPoints > 0 && (
                    <p className="flex items-center gap-2 text-tint-yellow-icon">
                      <Flame className="size-4" /> {plural(c.activeWeakPoints, 'point bloquant', 'points bloquants')}
                    </p>
                  )}
                  {c.inProgressSessions === 0 && c.activeWeakPoints === 0 && <p className="text-ink-3">Rien en cours</p>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {usage.data && usage.data.calls > 0 && (
        <p className="mt-16 text-xs text-ink-3">
          Consommation IA estimée : {usage.data.costUsd.toFixed(2)} $ ({plural(usage.data.calls, 'appel', 'appels')})
        </p>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nouveau cours"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button variant="primary" loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>
              Créer le cours
            </Button>
          </>
        }
      >
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Field label="Nom">
            <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Algèbre linéaire" />
          </Field>
          <ColorPicker value={color} onChange={setColor} />
          <ErrorBox error={create.error} />
        </form>
      </Modal>
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Couleur</legend>
      <div className="flex flex-wrap gap-2">
        {COURSE_COLORS.map((c) => (
          <button
            type="button"
            key={c}
            onClick={() => onChange(c)}
            aria-label={`Couleur ${c}`}
            aria-pressed={value === c}
            className="size-8 rounded-full ring-offset-2 ring-offset-page transition-shadow aria-pressed:ring-2 aria-pressed:ring-ink"
            style={{ background: c }}
          />
        ))}
      </div>
    </fieldset>
  );
}
