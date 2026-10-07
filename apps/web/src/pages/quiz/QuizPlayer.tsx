// Quiz (révision ou quiz complet) : une question à la fois, QCM ou réponse courte corrigée par l'IA,
// explication après chaque réponse et score final.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QuizDto, QuizItemDto } from '@tpassist/shared';
import clsx from 'clsx';
import { CheckCircle2, ChevronLeft, ChevronRight, RotateCcw, Trophy, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Callout, ErrorBox, Page, ProgressBar, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useBreadcrumbs } from '../../lib/breadcrumbs';
import { QuizQuestion, type QuizDraft } from './QuizQuestion';

/** Quiz (route /quizzes/:quizId). */
export function QuizPlayer() {
  const { quizId } = useParams<{ quizId: string }>();
  const qc = useQueryClient();
  const key = ['quiz', quizId];
  const quiz = useQuery({
    queryKey: key,
    queryFn: () => api.get<QuizDto>(`/api/quizzes/${quizId}`),
    refetchInterval: (q) => (q.state.data?.status === 'generating' ? 2000 : false),
  });
  const q = quiz.data;
  useBreadcrumbs(q ? [{ label: q.courseName, to: `/courses/${q.courseId}` }, { label: q.title }] : []);

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuizDraft>>({});

  useEffect(() => {
    // Reprise : on se place sur le premier item sans réponse.
    if (q?.status === 'ready' && q.items.length) {
      const first = q.items.findIndex((i) => !i.answered);
      setIndex(first < 0 ? 0 : first);
    }
  }, [q?.id, q?.status]);

  const answer = useMutation({
    mutationFn: (it: QuizItemDto) => api.post<QuizDto>(`/api/quizzes/${quizId}/items/${it.id}/answer`, answers[it.id] ?? {}),
    onSuccess: (d) => qc.setQueryData(key, d),
  });
  const restart = useMutation({
    mutationFn: () => api.post<QuizDto>(`/api/quizzes/${quizId}/restart`),
    onSuccess: (d) => {
      qc.setQueryData(key, d);
      setAnswers({});
      setIndex(0);
    },
  });
  const retry = useMutation({ mutationFn: () => api.post<QuizDto>(`/api/quizzes/${quizId}/retry`), onSuccess: (d) => qc.setQueryData(key, d) });

  if (quiz.isLoading) return <Page width="reading"><Spinner label="Chargement du quiz…" /></Page>;
  if (quiz.error || !q) return <Page width="reading"><ErrorBox error={quiz.error ?? 'Quiz introuvable'} /></Page>;

  if (q.status === 'generating') {
    return (
      <Page width="reading">
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Spinner />
          <h1 className="text-xl font-semibold tracking-tight">Préparation du quiz…</h1>
          <p className="max-w-md text-sm text-ink-3">L’IA rédige les questions en ciblant tes points bloquants.</p>
        </div>
      </Page>
    );
  }
  if (q.status === 'error') {
    return (
      <Page width="reading">
        <Callout
          tone="red"
          icon={<XCircle className="size-4" />}
          title="La génération du quiz a échoué"
          aside={
            <Button variant="raised" loading={retry.isPending} onClick={() => retry.mutate()}>
              Relancer
            </Button>
          }
        >
          <p className="text-sm">{q.error}</p>
        </Callout>
      </Page>
    );
  }

  const answeredCount = q.items.filter((i) => i.answered).length;
  const item = q.items[index];

  return (
    <Page width="reading">
      <header className="mb-8">
        <h1 className="text-3xl leading-tight font-semibold tracking-tight">{q.title}</h1>
        <div className="mt-4 flex items-center gap-4">
          <ProgressBar value={answeredCount / Math.max(1, q.items.length)} className="max-w-xs" />
          <span className="text-sm whitespace-nowrap text-ink-3 tabular-nums">
            {answeredCount} sur {q.items.length}
          </span>
        </div>
      </header>

      {q.status === 'done' && (
        <Callout
          tone="green"
          icon={<Trophy className="size-4" />}
          title={`Score : ${q.score} sur ${q.total}`}
          className="mb-8"
          aside={
            <Button variant="raised" icon={<RotateCcw className="size-4" />} loading={restart.isPending} onClick={() => restart.mutate()}>
              Recommencer
            </Button>
          }
        >
          <p className="text-sm">Tes points bloquants ont été mis à jour selon tes réponses.</p>
        </Callout>
      )}

      {item && (
        <section className="space-y-6">
          <QuizQuestion
            item={item}
            number={index + 1}
            draft={answers[item.id]}
            onDraft={(d) => setAnswers((a) => ({ ...a, [item.id]: d }))}
            onSubmit={() => answer.mutate(item)}
            submitting={answer.isPending}
            error={answer.error}
          />
          <div className="flex justify-between pt-4">
            <Button variant="tertiary" disabled={index === 0} onClick={() => setIndex(index - 1)} icon={<ChevronLeft className="size-4" />}>
              Précédente
            </Button>
            <Button variant={item.answered ? 'secondary' : 'tertiary'} disabled={index >= q.items.length - 1} onClick={() => setIndex(index + 1)}>
              Suivante <ChevronRight className="size-4" />
            </Button>
          </div>
        </section>
      )}

      <nav className="mt-12 flex flex-wrap gap-1" aria-label="Questions du quiz">
        {q.items.map((it, i) => (
          <NavDot key={it.id} n={i + 1} current={i === index} onClick={() => setIndex(i)} state={it.answered ? (it.correct ? 'correct' : 'wrong') : 'todo'} />
        ))}
      </nav>
    </Page>
  );
}

/** Case de navigation d'une question : numéro, ou coche / croix une fois répondue. */
function NavDot({ n, current, onClick, state }: { n: number; current: boolean; onClick: () => void; state: 'correct' | 'wrong' | 'todo' }) {
  const label = `Question ${n}${state === 'correct' ? ' : juste' : state === 'wrong' ? ' : fausse' : ''}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={current}
      title={label}
      className={clsx(
        'grid size-8 place-items-center rounded text-xs transition-colors',
        current
          ? 'bg-accent text-accent-ink'
          : state === 'correct'
            ? 'bg-tint-green text-tint-green-icon'
            : state === 'wrong'
              ? 'bg-tint-red text-tint-red-icon'
              : 'bg-block text-ink-3 hover:bg-hover',
      )}
    >
      {state === 'correct' ? <CheckCircle2 className="size-4" /> : state === 'wrong' ? <XCircle className="size-4" /> : n}
    </button>
  );
}
