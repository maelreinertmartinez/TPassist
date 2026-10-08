// Liste des TD, TP ou EI d'un cours, avec leur lancement, la reprise d'une séance et le dernier bilan.
import { UNIT_KIND_LABELS, type CourseDetail, type UnitDto } from '@tpassist/shared';
import { CheckCircle2, Hand, Pencil, Play, RotateCcw, ScrollText, Sparkles, Timer } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, IconButton, Tag } from '../../components/ui';
import { formatDate, formatPageRange, plural } from '../../lib/format';
import { KIND_ICON, Row } from './common';

/**
 * @param sessions toutes les séances du cours, de la plus récente à la plus ancienne
 * @param launching id de l'unité dont la séance est en cours de création
 */
export function UnitList({ units, sessions, onLaunch, launching }: { units: UnitDto[]; sessions: CourseDetail['sessions']; onLaunch: (u: UnitDto) => void; launching?: string }) {
  const navigate = useNavigate();
  if (units.length === 0) return <p className="px-2 text-sm text-ink-3">Rien ici pour l’instant.</p>;
  return (
    <ul className="space-y-1">
      {units.map((u) => {
        const running = sessions.find((s) => s.unitId === u.id && s.status === 'in_progress');
        const last = sessions.find((s) => s.unitId === u.id && s.status !== 'in_progress');
        const meta = [
          UNIT_KIND_LABELS[u.kind],
          plural(u.questionCount, 'question'),
          u.documentName ? `${u.documentName}, ${formatPageRange(u.pageStart, u.pageEnd)}` : u.origin === 'generated' ? 'générée par l’IA' : null,
          u.kind === 'ei' && u.meta.durationMinutes ? `${u.meta.durationMinutes} min` : null,
          last && (last.status === 'reporting' ? 'bilan en préparation' : `terminé le ${formatDate(last.updatedAt)}${last.score !== null ? ` · ${last.score}/20` : ''}`),
        ].filter(Boolean);
        return (
          <Row
            key={u.id}
            icon={KIND_ICON[u.kind]}
            title={u.title}
            meta={
              <span className="flex flex-wrap items-center gap-2">
                {meta.join(' · ')}
                {u.hasCorrection && (
                  <Tag tone="green">
                    <CheckCircle2 className="size-3" /> Corrigé
                  </Tag>
                )}
                {u.origin === 'manual' && (
                  <Tag>
                    <Hand className="size-3" /> Ajoutée à la main
                  </Tag>
                )}
                {u.origin === 'generated' && (
                  <Tag tone="blue">
                    <Sparkles className="size-3" /> IA
                  </Tag>
                )}
              </span>
            }
            actions={
              <>
                <IconButton label="Modifier la structure" onClick={() => navigate(`/units/${u.id}/edit`)}>
                  <Pencil className="size-4" />
                </IconButton>
                {last && (
                  <Button
                    size="sm"
                    variant="tertiary"
                    icon={last.reportId && last.status === 'done' ? <ScrollText className="size-4" /> : undefined}
                    loading={last.status === 'reporting' || !last.reportId}
                    onClick={() => last.reportId && navigate(`/reports/${last.reportId}`)}
                  >
                    Bilan
                  </Button>
                )}
                {running ? (
                  <Button size="sm" icon={<Play className="size-4" />} onClick={() => navigate(`/sessions/${running.id}`)}>
                    Reprendre
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    icon={last ? <RotateCcw className="size-4" /> : u.kind === 'ei' ? <Timer className="size-4" /> : <Play className="size-4" />}
                    loading={launching === u.id}
                    disabled={u.questionCount === 0}
                    onClick={() => onLaunch(u)}
                  >
                    {last ? 'Recommencer' : 'Lancer'}
                  </Button>
                )}
              </>
            }
          />
        );
      })}
    </ul>
  );
}
