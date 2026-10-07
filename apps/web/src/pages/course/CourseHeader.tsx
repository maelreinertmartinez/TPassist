// En-tête d'un cours, façon page Notion : icône (cliquable pour la changer), nom, résumé du contenu et actions.
import type { CourseDetail } from '@tpassist/shared';
import { ClipboardCheck, FileUp, MessageCircleQuestion, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CourseIconTile } from '../../components/CourseAppearance';
import { Button, ErrorBox, IconButton, Menu } from '../../components/ui';
import { plural } from '../../lib/format';
import { useDeleteCourse } from '../../lib/useDeleteCourse';

interface Props {
  detail: CourseDetail;
  /** Nombre de chapitres, de TD/TP et d'EI, pour le résumé et les actions disponibles. */
  counts: { chapters: number; exercises: number; ei: number };
  onSettings: () => void;
  onUpload: () => void;
  onQuiz: () => void;
  onGenerateEi: () => void;
  onChat: () => void;
}

export function CourseHeader({ detail: d, counts, onSettings, onUpload, onQuiz, onGenerateEi, onChat }: Props) {
  const navigate = useNavigate();
  const deleteCourse = useDeleteCourse();
  const summary = [
    counts.chapters && plural(counts.chapters, 'chapitre'),
    counts.exercises && `${counts.exercises} TD/TP`,
    counts.ei && `${counts.ei} EI`,
    plural(d.documents.length, 'document'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <header className="mb-8">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onSettings}
          title="Changer l’icône et la couleur"
          aria-label="Changer l’icône et la couleur du cours"
          className="shrink-0 rounded-lg transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <CourseIconTile icon={d.course.icon} color={d.course.color} size="lg" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl leading-tight font-semibold tracking-tight">{d.course.name}</h1>
            <IconButton label="Modifier le cours" onClick={onSettings}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Supprimer le cours" disabled={deleteCourse.deletingId === d.course.id} onClick={() => deleteCourse.ask(d.course, () => navigate('/'))}>
              <Trash2 className="size-4" />
            </IconButton>
          </div>
          <p className="mt-1 text-sm text-ink-3">{summary}</p>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button icon={<FileUp className="size-4" />} onClick={onUpload}>
          Ajouter des fichiers
        </Button>
        <Menu
          label="Réviser"
          icon={<Sparkles className="size-4" />}
          items={[
            { label: 'Quiz complet sur le cours', icon: <Sparkles className="size-4" />, onSelect: onQuiz, disabled: d.units.length === 0 },
            {
              label: 'Générer une EI blanche',
              icon: <ClipboardCheck className="size-4" />,
              onSelect: onGenerateEi,
              disabled: counts.ei === 0,
              hint: counts.ei === 0 ? 'Ajoute d’abord au moins une EI' : undefined,
            },
          ]}
        />
        <Button variant="tertiary" icon={<MessageCircleQuestion className="size-4" />} onClick={onChat}>
          Poser une question
        </Button>
      </div>
      {deleteCourse.error != null && (
        <div className="mt-4">
          <ErrorBox error={deleteCourse.error} />
        </div>
      )}
    </header>
  );
}
