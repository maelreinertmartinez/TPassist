import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiHealth, CourseSummary, UsageSummary } from '@tpassist/shared';
import { AlertTriangle, BookOpen, Flame, FolderPlus, Play, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, inputClass, Modal, Spinner } from '../components/ui';
import { api } from '../lib/api';

export const COURSE_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#2563eb'];

export function Dashboard() {
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Mes cours</h1>
          <p className="mt-1 text-sm text-muted">Importe tes PDF de cours, TD, TP et EI, puis lance un TP question par question avec l’aide de l’IA.</p>
        </div>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
          Nouveau cours
        </Button>
      </div>

      {health.data && !health.data.ok && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">L’IA n’est pas disponible.</p>
            <p>{health.data.message}</p>
          </div>
        </div>
      )}

      {courses.isLoading ? (
        <Spinner label="Chargement…" />
      ) : courses.error ? (
        <ErrorBox error={courses.error} onRetry={() => courses.refetch()} />
      ) : courses.data?.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-8" />} title="Aucun cours pour l’instant">
          Crée une première tuile de cours, puis ajoute-y tes PDF : l’IA détectera automatiquement les parties de cours, TD, TP, corrigés et EI.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.data?.map((c) => (
            <Link key={c.id} to={`/courses/${c.id}`} className="group">
              <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-lg">
                <div className="h-2" style={{ background: c.color }} />
                <div className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-lg font-semibold leading-snug">{c.name}</h3>
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg text-white" style={{ background: c.color }}>
                      <BookOpen className="size-4" />
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge>{c.counts.cours} cours</Badge>
                    <Badge>{c.counts.td} TD</Badge>
                    <Badge>{c.counts.tp} TP</Badge>
                    <Badge>{c.counts.ei} EI</Badge>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted">
                    {c.inProgressSessions > 0 && (
                      <span className="inline-flex items-center gap-1 text-accent">
                        <Play className="size-3.5" /> {c.inProgressSessions} en cours
                      </span>
                    )}
                    {c.activeWeakPoints > 0 && (
                      <span className="inline-flex items-center gap-1 text-warn">
                        <Flame className="size-3.5" /> {c.activeWeakPoints} point(s) bloquant(s)
                      </span>
                    )}
                    {c.inProgressSessions === 0 && c.activeWeakPoints === 0 && <span>Aucune session en cours</span>}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
          <button
            onClick={() => setOpen(true)}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <FolderPlus className="size-6" />
            <span className="text-sm font-medium">Ajouter un cours</span>
          </button>
        </div>
      )}

      {usage.data && usage.data.calls > 0 && (
        <p className="mt-10 text-xs text-muted">
          Consommation IA estimée : {usage.data.calls} appels — {usage.data.costUsd.toFixed(2)} $
        </p>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nouveau cours"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button variant="primary" loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>
              Créer
            </Button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Field label="Nom du cours">
            <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Algèbre linéaire" />
          </Field>
          <Field label="Couleur">
            <div className="flex flex-wrap gap-2">
              {COURSE_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className="size-8 rounded-full ring-offset-2 ring-offset-surface"
                  style={{ background: c, boxShadow: color === c ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${c}` : undefined }}
                  aria-label={`Couleur ${c}`}
                />
              ))}
            </div>
          </Field>
          <ErrorBox error={create.error} />
        </form>
      </Modal>
    </div>
  );
}
