import { useMutation, useQuery } from '@tanstack/react-query';
import { SESSION_MODE_LABELS, UNIT_KIND_LABELS, type QuizDto, type ReportDto, type ReportQuestion } from '@tpassist/shared';
import clsx from 'clsx';
import { ArrowLeft, CheckCircle2, Clock, Download, Flame, Sparkles, ThumbsUp, XCircle, MinusCircle } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { Badge, Button, Card, ErrorBox, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, formatMinutes } from '../lib/format';

function exportPdf() {
  // Les blocs repliés sont dépliés pour l'impression, puis restaurés.
  const closed = [...document.querySelectorAll('details:not([open])')] as HTMLDetailsElement[];
  closed.forEach((d) => (d.open = true));
  const restore = () => {
    closed.forEach((d) => (d.open = false));
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}

export function ReportView() {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();
  const report = useQuery({
    queryKey: ['report', reportId],
    queryFn: () => api.get<ReportDto>(`/api/reports/${reportId}`),
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 2500 : false),
  });
  const r = report.data;

  const reviewQuiz = useMutation({
    mutationFn: () => api.post<QuizDto>(`/api/sessions/${r!.sessionId}/review-quiz`),
    onSuccess: (q) => navigate(`/quizzes/${q.id}`),
  });
  const retry = useMutation({ mutationFn: () => api.post(`/api/sessions/${r!.sessionId}/report/retry`), onSuccess: () => report.refetch() });

  if (report.isLoading) return <div className="p-8"><Spinner label="Chargement du bilan…" /></div>;
  if (report.error || !r) return <div className="p-8"><ErrorBox error={report.error ?? 'Bilan introuvable'} /></div>;

  if (r.status === 'pending') {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <Spinner className="justify-center" />
        <h1 className="mt-4 text-xl font-semibold">Bilan en préparation…</h1>
        <p className="mt-2 text-sm text-muted">L’IA reprend chaque question, tes réponses et tes erreurs. Cela peut prendre une ou deux minutes.</p>
      </div>
    );
  }
  if (r.status === 'error') {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-16">
        <ErrorBox error={`La génération du bilan a échoué : ${r.error}`} />
        <Button variant="primary" loading={retry.isPending} onClick={() => retry.mutate()}>
          Relancer la génération
        </Button>
      </div>
    );
  }

  const counts = {
    correct: r.questions.filter((q) => q.status === 'correct').length,
    wrong: r.questions.filter((q) => q.status === 'wrong').length,
    skipped: r.questions.filter((q) => q.status === 'skipped' || q.status === 'unseen' || q.status === 'seen').length,
  };
  const totalTime = r.questions.reduce((a, q) => a + q.activeMs, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to={`/courses/${r.courseId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="size-4" /> Retour au cours
        </Link>
        <Button icon={<Download className="size-4" />} onClick={exportPdf}>
          Exporter en PDF
        </Button>
      </div>

      <header className="mb-6">
        <p className="text-sm text-muted">
          Bilan — {UNIT_KIND_LABELS[r.unitKind]}
          {r.mode !== 'tp' ? ` · ${SESSION_MODE_LABELS[r.mode]}` : ''} · {formatDate(r.createdAt)}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{r.unitTitle}</h1>
        <div className="mt-4 flex flex-wrap gap-3">
          {r.score !== null && (
            <div className="rounded-xl border border-border bg-surface px-4 py-2">
              <p className="text-xs text-muted">Note</p>
              <p className="text-2xl font-semibold">
                {r.score}
                <span className="text-base text-muted">/20</span>
              </p>
            </div>
          )}
          <Stat icon={<CheckCircle2 className="size-4 text-ok" />} label="Réussies" value={counts.correct} />
          <Stat icon={<XCircle className="size-4 text-bad" />} label="Fausses" value={counts.wrong} />
          <Stat icon={<MinusCircle className="size-4 text-warn" />} label="Passées" value={counts.skipped} />
          <Stat icon={<Clock className="size-4 text-muted" />} label="Temps actif" value={formatMinutes(totalTime)} />
        </div>
      </header>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card className="print-break p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <ThumbsUp className="size-4 text-ok" /> Points forts
          </p>
          <Markdown className="text-sm">{r.strengthsMd || '—'}</Markdown>
        </Card>
        <Card className="print-break p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Flame className="size-4 text-warn" /> Points bloquants
          </p>
          {r.blockingPoints.length === 0 ? (
            <p className="text-sm text-muted">Aucun point bloquant relevé. 🎉</p>
          ) : (
            <ul className="space-y-2">
              {r.blockingPoints.map((b, i) => (
                <li key={i} className="text-sm">
                  <p className="font-medium">{b.notion}</p>
                  <Markdown className="text-muted">{b.descriptionMd}</Markdown>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {r.overallMd && (
        <Card className="print-break mb-6 p-4">
          <p className="mb-2 text-sm font-semibold">Bilan global</p>
          <Markdown className="text-sm">{r.overallMd}</Markdown>
        </Card>
      )}

      <ReviewQuizProposal report={r} onStart={() => reviewQuiz.mutate()} starting={reviewQuiz.isPending} error={reviewQuiz.error} />

      <h2 className="mt-8 mb-3 text-lg font-semibold">Détail question par question</h2>
      <div className="space-y-3">
        {r.questions.map((q) => (
          <QuestionReport key={q.questionId} q={q} />
        ))}
      </div>

      <div className="no-print mt-8">
        <ReviewQuizProposal report={r} onStart={() => reviewQuiz.mutate()} starting={reviewQuiz.isPending} error={null} compact />
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-2">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        {icon} {label}
      </p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

function ReviewQuizProposal({ report, onStart, starting, error, compact }: { report: ReportDto; onStart: () => void; starting: boolean; error: unknown; compact?: boolean }) {
  const navigate = useNavigate();
  const { reviewQuiz } = report;
  if (reviewQuiz.quizId) {
    return (
      <Card className="no-print flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm">Ton quiz de révision est disponible.</p>
        <Button variant="primary" onClick={() => navigate(`/quizzes/${reviewQuiz.quizId}`)} icon={<Sparkles className="size-4" />}>
          Ouvrir le quiz de révision
        </Button>
      </Card>
    );
  }
  return (
    <Card className={clsx('no-print space-y-3 border-accent/40 p-4', !compact && 'bg-accent-soft')}>
      <p className="text-sm font-medium">
        {reviewQuiz.noStruggle
          ? 'Bravo ! Un petit quiz pour consolider ?'
          : `Veux-tu faire un quiz de révision sur les points où tu as eu du mal ? (${reviewQuiz.proposedSize} questions)`}
      </p>
      {!compact && <p className="text-sm text-muted">Facultatif : le quiz n’est généré que si tu le lances. Tu pourras aussi le faire plus tard depuis ce bilan.</p>}
      <div className="flex gap-2">
        <Button variant="primary" loading={starting} onClick={onStart} icon={<Sparkles className="size-4" />}>
          Lancer le quiz
        </Button>
        {!compact && (
          <Link to={`/courses/${report.courseId}`}>
            <Button variant="ghost">Plus tard</Button>
          </Link>
        )}
      </div>
      <ErrorBox error={error} />
    </Card>
  );
}

function QuestionReport({ q }: { q: ReportQuestion }) {
  const tone = q.status === 'correct' ? 'ok' : q.status === 'wrong' ? 'bad' : 'warn';
  const helped = q.helps.length > 0;
  return (
    <details className="print-break group rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={clsx('size-2.5 shrink-0 rounded-full', tone === 'ok' ? (helped ? 'bg-warn' : 'bg-ok') : tone === 'bad' ? 'bg-bad' : 'bg-muted')} />
          <span className="truncate text-sm font-medium">
            {q.exerciseTitle} — Question {q.label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {q.score !== null && (
            <Badge tone={q.maxScore && q.score >= q.maxScore * 0.75 ? 'ok' : q.score ? 'warn' : 'bad'}>
              {q.score}/{q.maxScore}
            </Badge>
          )}
          <Badge tone={tone}>{q.status === 'correct' ? 'Juste' : q.status === 'wrong' ? 'Faux' : 'Sans réponse'}</Badge>
        </div>
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4">
        <div className="space-y-2">
          {q.contextMd.trim() && <Markdown className="rounded-lg bg-surface-2 px-3 py-2 text-sm">{q.contextMd}</Markdown>}
          <Markdown className="text-sm">{q.statementMd}</Markdown>
        </div>
        <p className="text-xs text-muted">
          Temps actif : {formatMinutes(q.activeMs)} · Aides : {q.helps.length ? q.helps.join(', ') : 'aucune'}
        </p>

        {q.attempts.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold">Tes réponses</p>
            {q.attempts.map((a, i) => (
              <div key={i} className="space-y-1.5 rounded-lg border border-border p-3">
                <p className="flex items-center gap-2 text-xs text-muted">
                  Tentative {i + 1}
                  {a.verdict !== 'pending' && (
                    <Badge tone={a.verdict === 'correct' ? 'ok' : 'bad'}>{a.verdict === 'correct' ? 'juste' : a.verdict === 'partiel' ? 'partielle' : 'fausse'}</Badge>
                  )}
                </p>
                {a.type === 'image' && a.imageUrl ? (
                  <img src={a.imageUrl} alt="" className="max-h-72 rounded-md border border-border" />
                ) : a.type === 'code' ? (
                  <pre className="overflow-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-xs whitespace-pre-wrap">{a.code}</pre>
                ) : (
                  <Markdown className="text-sm">{a.text ?? ''}</Markdown>
                )}
                {a.errorLocation && (
                  <p className="text-sm">
                    <span className="font-medium text-bad">Erreur : </span>« {a.errorLocation} »
                  </p>
                )}
                {a.errorExplanation && <Markdown className="text-sm text-muted">{a.errorExplanation}</Markdown>}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-sm font-semibold">Explications</p>
          <Markdown className="text-sm">{q.explanationMd}</Markdown>
        </div>
        <div className="space-y-1.5 rounded-lg border-l-4 border-ok bg-ok-soft/40 px-3 py-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            Solution
            <Badge tone={q.solutionSource === 'official' ? 'ok' : 'accent'}>{q.solutionSource === 'official' ? 'corrigé officiel' : 'IA'}</Badge>
          </p>
          <Markdown className="text-sm">{q.solutionMd}</Markdown>
        </div>
      </div>
    </details>
  );
}
