import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QuizDto, QuizItemDto } from '@tpassist/shared';
import clsx from 'clsx';
import { CheckCircle2, ChevronLeft, ChevronRight, Flame, RotateCcw, Trophy, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { Button, Callout, ErrorBox, ProgressBar, Spinner, Tag, TextArea } from '../components/ui';
import { api } from '../lib/api';
import { useBreadcrumbs } from '../lib/breadcrumbs';

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
  const course = useQuery({ queryKey: ['course-name', q?.courseId], queryFn: () => api.get<{ course: { name: string } }>(`/api/courses/${q!.courseId}`), enabled: Boolean(q?.courseId) });
  useBreadcrumbs(q ? [{ label: course.data?.course.name ?? 'Cours', to: `/courses/${q.courseId}` }, { label: q.title }] : []);

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { choice?: number; text?: string }>>({});

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

  if (quiz.isLoading) return <Doc><Spinner label="Chargement du quiz…" /></Doc>;
  if (quiz.error || !q) return <Doc><ErrorBox error={quiz.error ?? 'Quiz introuvable'} /></Doc>;

  if (q.status === 'generating') {
    return (
      <Doc>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Spinner />
          <h1 className="text-xl font-semibold tracking-tight">Préparation du quiz…</h1>
          <p className="max-w-md text-sm text-ink-3">L’IA rédige les questions en ciblant tes points bloquants.</p>
        </div>
      </Doc>
    );
  }
  if (q.status === 'error') {
    return (
      <Doc>
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
      </Doc>
    );
  }

  const answeredCount = q.items.filter((i) => i.answered).length;
  const item = q.items[index];
  const done = q.status === 'done';
  const draft = item ? answers[item.id] : undefined;

  return (
    <Doc>
      <header className="mb-8">
        <h1 className="text-3xl leading-tight font-semibold tracking-tight">{q.title}</h1>
        <div className="mt-4 flex items-center gap-4">
          <ProgressBar value={answeredCount / Math.max(1, q.items.length)} className="max-w-xs" />
          <span className="text-sm whitespace-nowrap text-ink-3 tabular-nums">
            {answeredCount} sur {q.items.length}
          </span>
        </div>
      </header>

      {done && (
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
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
              Question {index + 1} · {item.type === 'mcq' ? 'QCM' : 'question ouverte'}
              {item.weakPointNotion && (
                <Tag tone="yellow">
                  <Flame className="size-3" /> {item.weakPointNotion}
                </Tag>
              )}
            </p>
            <Markdown className="text-base">{item.promptMd}</Markdown>
          </div>

          {item.type === 'mcq' ? (
            <div className="space-y-2" role="radiogroup">
              {item.choices.map((c, i) => {
                const selected = (item.answered ? item.userChoice : draft?.choice) === i;
                const isRight = item.answered && item.correctIndex === i;
                const isWrongPick = item.answered && selected && !isRight;
                return (
                  <button
                    type="button"
                    key={i}
                    role="radio"
                    aria-checked={selected}
                    disabled={item.answered}
                    onClick={() => setAnswers((a) => ({ ...a, [item.id]: { choice: i } }))}
                    className={clsx(
                      'flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left text-sm transition-colors',
                      isRight
                        ? 'bg-tint-green text-tint-green-ink ring-2 ring-green-500'
                        : isWrongPick
                          ? 'bg-tint-red text-tint-red-ink ring-2 ring-red-500'
                          : selected
                            ? 'bg-tint-blue text-tint-blue-ink ring-2 ring-accent'
                            : 'bg-block hover:bg-hover disabled:hover:bg-block',
                    )}
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-page text-xs font-semibold text-ink shadow-e1">{String.fromCharCode(65 + i)}</span>
                    <Markdown className="min-w-0 flex-1">{c}</Markdown>
                    {isRight && <CheckCircle2 className="size-4 shrink-0" />}
                    {isWrongPick && <XCircle className="size-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ) : item.answered ? (
            <div className="rounded-lg bg-block px-4 py-3">
              <p className="mb-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">Ta réponse</p>
              <Markdown className="text-sm">{item.userAnswer ?? ''}</Markdown>
            </div>
          ) : (
            <TextArea rows={4} value={draft?.text ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [item.id]: { text: e.target.value } }))} placeholder="Ta réponse (LaTeX : $...$)" />
          )}

          {item.answered ? (
            <Callout tone={item.correct ? 'green' : 'red'} icon={item.correct ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />} title={item.correct ? 'Bonne réponse' : 'Ce n’est pas ça'}>
              <div className="space-y-2 text-sm">
                {item.feedbackMd && <Markdown>{item.feedbackMd}</Markdown>}
                {item.expectedAnswerMd && (
                  <div>
                    <p className="font-semibold">Réponse attendue</p>
                    <Markdown>{item.expectedAnswerMd}</Markdown>
                  </div>
                )}
                {item.explanationMd && <Markdown>{item.explanationMd}</Markdown>}
              </div>
            </Callout>
          ) : (
            <Button
              variant="primary"
              loading={answer.isPending}
              disabled={item.type === 'mcq' ? draft?.choice === undefined : !draft?.text?.trim()}
              onClick={() => answer.mutate(item)}
            >
              Valider
            </Button>
          )}
          <ErrorBox error={answer.error} />

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
    </Doc>
  );
}

function Doc({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-2xl px-4 pt-12 pb-24 sm:px-6">{children}</div>;
}

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
