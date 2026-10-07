// Tableau de bord : les cours en tuiles (création, suppression) et l'alerte si l'IA est indisponible.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COURSE_COLORS, type CourseSummary } from '@tpassist/shared';
import clsx from 'clsx';
import { AlertTriangle, BookOpen, Flame, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAiHealth } from '../components/AppShell';
import { ColorPicker, CourseIconTile, IconPicker } from '../components/CourseAppearance';
import { Button, Callout, EmptyState, ErrorBox, Field, IconButton, Modal, Page, Spinner, TextInput } from '../components/ui';
import { api } from '../lib/api';
import { useBreadcrumbs } from '../lib/breadcrumbs';
import { plural } from '../lib/format';
import { useDeleteCourse } from '../lib/useDeleteCourse';

/** Contenu du cours en une ligne : « 3 chapitres · 2 TD · 1 EI ». */
function courseMeta(c: CourseSummary) {
  const parts = [
    c.counts.cours && plural(c.counts.cours, 'chapitre'),
    c.counts.td && `${c.counts.td} TD`,
    c.counts.tp && `${c.counts.tp} TP`,
    c.counts.ei && plural(c.counts.ei, 'EI', 'EI'),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Aucun document pour l’instant';
}

/** Tableau de bord (route /). */
export function Dashboard() {
  useBreadcrumbs([]);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api.get<CourseSummary[]>('/api/courses') });
  const health = useAiHealth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(COURSE_COLORS[0]);
  const [icon, setIcon] = useState('graduation-cap');
  const deleteCourse = useDeleteCourse();

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/courses', { name, color, icon }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['courses'] });
      setOpen(false);
      setName('');
      navigate(`/courses/${c.id}`);
    },
  });

  const hasCourses = Boolean(courses.data?.length);

  return (
    <Page>
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

      <ErrorBox error={deleteCourse.error} />

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
            <div key={c.id} className={clsx('group relative', deleteCourse.deletingId === c.id && 'pointer-events-none opacity-50')}>
              <Link
                to={`/courses/${c.id}`}
                className="block h-full overflow-hidden rounded-lg bg-raised shadow-e1 transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <div className="h-1" style={{ background: c.color }} />
                <div className="space-y-4 p-6">
                  <div className="flex items-start gap-3 pr-8">
                    <CourseIconTile icon={c.icon} color={c.color} size="sm" />
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
              {/* Hors du lien : la corbeille n'ouvre pas le cours. Visible au survol sur ordinateur, toujours sur mobile. */}
              <IconButton
                label={`Supprimer « ${c.name} »`}
                onClick={() => deleteCourse.ask(c)}
                className="absolute top-4 right-4 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          ))}
        </div>
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
          <IconPicker value={icon} onChange={setIcon} color={color} />
          <ErrorBox error={create.error} />
        </form>
      </Modal>
    </Page>
  );
}
