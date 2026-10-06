import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QuizDto, QuizItemDto } from '@tpassist/shared';
import clsx from 'clsx';
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Flame, RotateCcw, Trophy, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { Badge, Button, Card, ErrorBox, ProgressBar, Spinner } from '../components/ui';
import { api } from '../lib/api';

export function QuizPlayer() {
  const { quizId } = useParams<{ quizId: string }>();
  const qc = useQueryClient();
  const key = ['quiz', quizId];
  const quiz = useQuery({
    queryKey: key,
    queryFn: () => api.get<QuizDto>(`/api/quizzes/${quizId}`),
    refetchInterval: (q) => (q.state.data?.status === 'generating' ? 2000 : false),
  });
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { choice?: number; text?: string }>>({});
  const q = quiz.data;

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

  if (quiz.isLoading) return <div className="p-8"><Spinner label="Chargement du quiz…" /></div>;
  if (quiz.error || !q) return <div className="p-8"><ErrorBox error={quiz.error ?? 'Quiz introuvable'} /></div>;

  const back = (
    <Link to={`/courses/${q.courseId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <ArrowLeft className="size-4" /> Retour au cours
    </Link>
  );

  if (q.status === 'generating') {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <Spinner className="justify-center" />
        <h1 className="mt-4 text-xl font-semibold">Préparation du quiz…</h1>
        <p className="mt-2 text-sm text-muted">L’IA rédige les questions en ciblant tes points bloquants.</p>
      </div>
    );
  }
  if (q.status === 'error') {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-10">
        {back}
        <ErrorBox error={`La génération du quiz a échoué : ${q.error}`} />
        <Button variant="primary" loading={retry.isPending} onClick={() => retry.mutate()}>
          Relancer la génération
        </Button>
      </div>
    );
  }

  const answeredCount = q.items.filter((i) => i.answered).length;
  const item = q.items[index];
  const done = q.status === 'done';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      {back}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{q.title}</h1>
        <span className="text-sm text-muted">
          {answeredCount}/{q.items.length} répondu(s)
        </span>
      </div>
      <ProgressBar value={answeredCount / Math.max(1, q.items.length)} className="mb-5" />

      {done && (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full bg-accent-soft text-accent">
              <Trophy className="size-5" />
            </span>
            <div>
              <p className="text-lg font-semibold">
                Score : {q.score}/{q.total}
              </p>
              <p className="text-sm text-muted">Les points bloquants travaillés ont été mis à jour selon tes réponses.</p>
            </div>
          </div>
          <Button icon={<RotateCcw className="size-4" />} loading={restart.isPending} onClick={() => restart.mutate()}>
            Recommencer
          </Button>
        </Card>
      )}

      {item && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">Question {index + 1}</Badge>
            <Badge>{item.type === 'mcq' ? 'QCM' : 'Question ouverte'}</Badge>
            {item.weakPointNotion && (
              <Badge tone="warn">
                <Flame className="size-3" /> {item.weakPointNotion}
              </Badge>
            )}
          </div>
          <Markdown className="text-[15px]">{item.promptMd}</Markdown>

          {item.type === 'mcq' ? (
            <div className="space-y-2">
              {item.choices.map((c, i) => {
                const selected = (item.answered ? item.userChoice : answers[item.id]?.choice) === i;
                const isRight = item.answered && item.correctIndex === i;
                const isWrongPick = item.answered && selected && !isRight;
                return (
                  <button
                    key={i}
                    disabled={item.answered}
                    onClick={() => setAnswers((a) => ({ ...a, [item.id]: { choice: i } }))}
                    className={clsx(
                      'flex w-full items-start gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors',
                      isRight ? 'border-ok bg-ok-soft' : isWrongPick ? 'border-bad bg-bad-soft' : selected ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2',
                    )}
                  >
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-current text-xs font-semibold">{String.fromCharCode(65 + i)}</span>
                    <Markdown className="min-w-0 flex-1">{c}</Markdown>
                    {isRight && <CheckCircle2 className="size-4 shrink-0 text-ok" />}
                    {isWrongPick && <XCircle className="size-4 shrink-0 text-bad" />}
                  </button>
                );
              })}
            </div>
          ) : item.answered ? (
            <div className="rounded-lg bg-surface-2 px-3 py-2">
              <p className="mb-1 text-xs text-muted">Ta réponse</p>
              <Markdown className="text-sm">{item.userAnswer ?? ''}</Markdown>
            </div>
          ) : (
            <textarea
              rows={4}
              value={answers[item.id]?.text ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [item.id]: { text: e.target.value } }))}
              placeholder="Ta réponse (LaTeX accepté : $...$)"
              className="w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-sm focus:border-accent focus:outline-none"
            />
          )}

          {item.answered ? (
            <div className={clsx('space-y-2 rounded-lg border px-4 py-3', item.correct ? 'border-ok/40 bg-ok-soft' : 'border-bad/40 bg-bad-soft')}>
              <p className={clsx('flex items-center gap-2 font-semibold', item.correct ? 'text-ok' : 'text-bad')}>
                {item.correct ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                {item.correct ? 'Bonne réponse' : 'Ce n’est pas ça'}
              </p>
              {item.feedbackMd && <Markdown className="text-sm">{item.feedbackMd}</Markdown>}
              {item.expectedAnswerMd && (
                <div className="text-sm">
                  <p className="font-medium">Réponse attendue :</p>
                  <Markdown>{item.expectedAnswerMd}</Markdown>
                </div>
              )}
              {item.explanationMd && <Markdown className="text-sm text-muted">{item.explanationMd}</Markdown>}
            </div>
          ) : (
            <Button
              variant="primary"
              loading={answer.isPending}
              disabled={item.type === 'mcq' ? answers[item.id]?.choice === undefined : !answers[item.id]?.text?.trim()}
              onClick={() => answer.mutate(item)}
            >
              Valider
            </Button>
          )}
          <ErrorBox error={answer.error} />

          <div className="flex justify-between border-t border-border pt-4">
            <Button variant="ghost" disabled={index === 0} onClick={() => setIndex(index - 1)} icon={<ChevronLeft className="size-4" />}>
              Précédente
            </Button>
            <Button variant={item.answered ? 'primary' : 'ghost'} disabled={index >= q.items.length - 1} onClick={() => setIndex(index + 1)}>
              Suivante <ChevronRight className="size-4" />
            </Button>
          </div>
        </Card>
      )}

      <div className="mt-5 flex flex-wrap gap-1.5">
        {q.items.map((it, i) => (
          <button
            key={it.id}
            onClick={() => setIndex(i)}
            className={clsx(
              'grid size-8 place-items-center rounded-md text-xs font-medium',
              i === index && 'ring-2 ring-accent',
              it.answered ? (it.correct ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad') : 'bg-surface-2 text-muted',
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
