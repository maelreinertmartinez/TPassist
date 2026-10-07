// Onglet « Historique » : séances (reprise ou bilan) et quiz du cours.
import type { CourseDetail } from '@tpassist/shared';
import { AlertCircle, CheckCircle2, Play, ScrollText, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Spinner, Tag } from '../../components/ui';
import { formatDate } from '../../lib/format';
import { KIND_ICON, Row } from './common';

/** Historique des séances et des quiz du cours. */
export function History({ detail }: { detail: CourseDetail }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-8">
      {detail.sessions.length > 0 && (
        <section>
          <h2 className="mb-2 px-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Séances</h2>
          <ul className="space-y-1">
            {detail.sessions.map((s) => (
              <Row
                key={s.id}
                icon={KIND_ICON[s.unitKind]}
                title={s.unitTitle}
                meta={
                  <>
                    {s.status === 'in_progress'
                      ? `En cours · ${s.progress.done}/${s.progress.total} questions`
                      : s.status === 'reporting'
                        ? 'Bilan en préparation…'
                        : `Terminée${s.score !== null ? ` · ${s.score}/20` : ''}`}
                    {' · '}
                    {formatDate(s.updatedAt)}
                  </>
                }
                actions={
                  s.status === 'in_progress' ? (
                    <Button size="sm" icon={<Play className="size-4" />} onClick={() => navigate(`/sessions/${s.id}`)}>
                      Reprendre
                    </Button>
                  ) : s.reportId ? (
                    <Button size="sm" variant="tertiary" icon={s.status === 'reporting' ? undefined : <ScrollText className="size-4" />} loading={s.status === 'reporting'} onClick={() => navigate(`/reports/${s.reportId}`)}>
                      Bilan
                    </Button>
                  ) : (
                    <Spinner />
                  )
                }
              />
            ))}
          </ul>
        </section>
      )}
      {detail.quizzes.length > 0 && (
        <section>
          <h2 className="mb-2 px-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Quiz</h2>
          <ul className="space-y-1">
            {detail.quizzes.map((q) => (
              <Row
                key={q.id}
                to={`/quizzes/${q.id}`}
                icon={<Sparkles className="size-4" />}
                title={q.title}
                meta={formatDate(q.createdAt)}
                actions={
                  q.status === 'generating' ? (
                    <Spinner />
                  ) : q.status === 'error' ? (
                    <Tag tone="red">
                      <AlertCircle className="size-3" /> Erreur
                    </Tag>
                  ) : q.status === 'done' ? (
                    <Tag tone="green">
                      <CheckCircle2 className="size-3" /> {q.score}/{q.total}
                    </Tag>
                  ) : (
                    <Tag tone="blue">À faire</Tag>
                  )
                }
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
