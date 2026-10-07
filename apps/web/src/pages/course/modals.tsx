// Fenêtres de la page d'un cours : quiz complet, génération d'EI, lancement d'une EI et réglages du cours.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CourseDetail, SessionMode, UnitDto } from '@tpassist/shared';
import clsx from 'clsx';
import { CheckCircle2, ClipboardCheck, Sparkles, Timer, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ColorPicker, IconPicker } from '../../components/CourseAppearance';
import { Button, ErrorBox, Field, Modal, Segmented, TextInput } from '../../components/ui';
import { api } from '../../lib/api';
import { useDeleteCourse } from '../../lib/useDeleteCourse';

/** Quiz complet sur tout le cours ; ouvre le quiz dès sa création. */
export function CourseQuizModal({ courseId, open, onClose }: { courseId: string; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [size, setSize] = useState<'court' | 'moyen' | 'long'>('court');
  const create = useMutation({ mutationFn: () => api.post<{ id: string }>(`/api/courses/${courseId}/quizzes`, { size }), onSuccess: (q) => navigate(`/quizzes/${q.id}`) });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quiz complet sur le cours"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
            Générer le quiz
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <p className="text-sm text-ink-2">QCM et questions ouvertes sur tout le cours. Tes points bloquants sont travaillés en priorité, sur environ 60 % des questions.</p>
        <Segmented
          value={size}
          onChange={setSize}
          items={[
            { value: 'court', label: '10 questions' },
            { value: 'moyen', label: '20 questions' },
            { value: 'long', label: '30 questions' },
          ]}
        />
        <ErrorBox error={create.error} />
      </div>
    </Modal>
  );
}

/** Génération d'une EI blanche (difficulté, chapitres ciblés) ; l'EI apparaît dans l'onglet EI une fois rédigée. */
export function GenerateEiModal({ detail, open, onClose, onDone }: { detail: CourseDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const [difficulty, setDifficulty] = useState('standard');
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () => api.post(`/api/courses/${detail.course.id}/generate-ei`, { difficulty, sectionIds }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const chapters = detail.units.filter((u) => u.kind === 'cours');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Générer une EI blanche"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
            Générer l’EI
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <p className="text-sm text-ink-2">L’IA reprend le style et le barème de tes EI, couvre le cours et donne la priorité à tes points bloquants. L’EI apparaîtra dans l’onglet EI.</p>
        <Field label="Difficulté">
          <Segmented
            value={difficulty}
            onChange={setDifficulty}
            items={[
              { value: 'facile', label: 'Facile' },
              { value: 'standard', label: 'Standard' },
              { value: 'difficile', label: 'Difficile' },
            ]}
          />
        </Field>
        {chapters.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Chapitres à cibler</legend>
            <p className="mb-2 text-xs text-ink-3">Optionnel : sans sélection, tout le cours est couvert.</p>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {chapters.flatMap((u) =>
                detail.sections
                  .filter((s) => s.unitId === u.id)
                  .map((s) => (
                    <label key={s.id} className="flex items-center gap-3 rounded px-2 py-1 text-sm hover:bg-hover">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={sectionIds.includes(s.id)}
                        onChange={(e) => setSectionIds((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
                      />
                      <span className="truncate">
                        {s.title} <span className="text-ink-3">· {u.title}</span>
                      </span>
                    </label>
                  )),
              )}
            </div>
          </fieldset>
        )}
        <ErrorBox error={create.error} />
      </div>
    </Modal>
  );
}

const EI_MODES: { value: SessionMode; title: string; description: string; icon: ReactNode }[] = [
  {
    value: 'ei_examen',
    title: 'Sans aide',
    description: 'Comme le jour J : ni aide ni chat, aucune correction pendant l’épreuve. Note sur 20 à la fin.',
    icon: <ClipboardCheck className="size-4" />,
  },
  {
    value: 'ei_aides',
    title: 'Avec aides',
    description: 'Comme un TD : aides, vérification et chat, avec le chronomètre. Note sur 20 à la fin.',
    icon: <Sparkles className="size-4" />,
  },
];

/** Lancement d'une EI : mode (avec ou sans aides) et durée. */
export function LaunchEiModal({ unit, onClose, onLaunch, loading }: { unit: UnitDto | null; onClose: () => void; onLaunch: (mode: SessionMode, minutes: number) => void; loading: boolean }) {
  const [mode, setMode] = useState<SessionMode>('ei_examen');
  const [minutes, setMinutes] = useState<number | ''>('');
  const duration = minutes || unit?.meta.durationMinutes || 120;
  return (
    <Modal
      open={Boolean(unit)}
      onClose={onClose}
      title={`Lancer « ${unit?.title ?? ''} »`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={loading} onClick={() => onLaunch(mode, Number(duration))} icon={<Timer className="size-4" />}>
            Commencer l’épreuve
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
          {EI_MODES.map((m) => (
            <button
              type="button"
              key={m.value}
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => setMode(m.value)}
              className={clsx(
                'rounded-lg p-4 text-left transition-shadow',
                mode === m.value ? 'bg-tint-blue text-tint-blue-ink ring-2 ring-accent' : 'bg-block hover:bg-hover',
              )}
            >
              <p className="flex items-center gap-2 text-sm font-semibold">
                {m.icon} {m.title}
                {mode === m.value && <CheckCircle2 className="ml-auto size-4 text-accent" />}
              </p>
              <p className="mt-1 text-xs">{m.description}</p>
            </button>
          ))}
        </div>
        <Field label="Durée en minutes" hint="Le chronomètre est sauvegardé : tu peux reprendre l’épreuve plus tard.">
          <TextInput type="number" min={5} value={minutes === '' ? duration : minutes} onChange={(e) => setMinutes(e.target.value ? Number(e.target.value) : '')} className="max-w-32" />
        </Field>
      </div>
    </Modal>
  );
}

/** Réglages du cours : nom, couleur, icône, et suppression. */
export function CourseSettingsModal({ detail, open, onClose }: { detail: CourseDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const deleteCourse = useDeleteCourse();
  const [name, setName] = useState(detail.course.name);
  const [color, setColor] = useState(detail.course.color);
  const [icon, setIcon] = useState(detail.course.icon);
  useEffect(() => {
    if (!open) return;
    setName(detail.course.name);
    setColor(detail.course.color);
    setIcon(detail.course.icon);
  }, [open]);
  const save = useMutation({
    mutationFn: () => api.patch(`/api/courses/${detail.course.id}`, { name, color, icon }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course', detail.course.id] });
      qc.invalidateQueries({ queryKey: ['courses'] });
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Modifier le cours"
      footer={
        <>
          <Button
            variant="danger-quiet"
            className="mr-auto"
            icon={<Trash2 className="size-4" />}
            loading={deleteCourse.deletingId === detail.course.id}
            onClick={() => deleteCourse.ask(detail.course, () => navigate('/'))}
          >
            Supprimer le cours
          </Button>
          <Button variant="tertiary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Field label="Nom">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ColorPicker value={color} onChange={setColor} />
        <IconPicker value={icon} onChange={setIcon} color={color} />
        <ErrorBox error={save.error ?? deleteCourse.error} />
      </div>
    </Modal>
  );
}
