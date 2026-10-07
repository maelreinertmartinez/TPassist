// Bilan de fin de séance : note (EI), points forts, points bloquants, quiz de révision proposé et détail de chaque question.
// Exportable en PDF (impression du navigateur, blocs dépliés).
import { useMutation, useQuery } from '@tanstack/react-query';
import { SESSION_MODE_LABELS, UNIT_KIND_LABELS, type QuestionStatus, type QuizDto, type ReportDto, type ReportQuestion } from '@tpassist/shared';
import { CheckCircle2, Clock, Download, Flame, MinusCircle, Sparkles, ThumbsUp, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnswerView, VerdictTag } from '../components/attempts';
import { Markdown } from '../components/Markdown';
import { QuestionStatement } from '../components/QuestionStatement';
import { Button, Callout, ErrorBox, Page, Spinner, Tag, Toggle, type Tone } from '../components/ui';
import { api } from '../lib/api';
import { useBreadcrumbs } from '../lib/breadcrumbs';
import { formatDate, formatMinutes, plural } from '../lib/format';

/** Imprime le bilan (ou l’enregistre en PDF) avec toutes les questions dépliées. */
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

/** Bilan (route /reports/:reportId). */
export function ReportView() {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();
  const report = useQuery({
    queryKey: ['report', reportId],
    queryFn: () => api.get<ReportDto>(`/api/reports/${reportId}`),
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 2500 : false),
  });
  const r = report.data;
  useBreadcrumbs(r ? [{ label: r.courseName, to: `/courses/${r.courseId}` }, { label: `Bilan · ${r.unitTitle}` }] : []);

  const reviewQuiz = useMutation({
    mutationFn: () => api.post<QuizDto>(`/api/sessions/${r!.sessionId}/review-quiz`),
    onSuccess: (q) => navigate(`/quizzes/${q.id}`),
  });
  const retry = useMutation({ mutationFn: () => api.post(`/api/sessions/${r!.sessionId}/report/retry`), onSuccess: () => report.refetch() });

  if (report.isLoading) return <Page width="document"><Spinner label="Chargement du bilan…" /></Page>;
  if (report.error || !r) return <Page width="document"><ErrorBox error={report.error ?? 'Bilan introuvable'} /></Page>;

  if (r.status === 'pending') {
    return (
      <Page width="document">
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Spinner />
          <h1 className="text-xl font-semibold tracking-tight">Bilan en préparation…</h1>
          <p className="max-w-md text-sm text-ink-3">L’IA reprend chaque question, tes réponses et tes erreurs. Cela prend une ou deux minutes.</p>
        </div>
      </Page>
    );
  }
  if (r.status === 'error') {
    return (
      <Page width="document">
        <Callout
          tone="red"
          icon={<XCircle className="size-4" />}
          title="La génération du bilan a échoué"
          aside={
            <Button variant="raised" loading={retry.isPending} onClick={() => retry.mutate()}>
              Relancer
            </Button>
          }
        >
          <p className="text-sm">{r.error}</p>
        </Callout>
      </Page>
    );
  }

  const counts = {
    correct: r.questions.filter((q) => q.status === 'correct').length,
    wrong: r.questions.filter((q) => q.status === 'wrong').length,
    skipped: r.questions.filter((q) => q.status !== 'correct' && q.status !== 'wrong').length,
  };
  const totalTime = r.questions.reduce((a, q) => a + q.activeMs, 0);

  return (
    <Page width="document">
      <header className="mb-12">
        <p className="text-sm text-ink-3">
          Bilan · {UNIT_KIND_LABELS[r.unitKind]}
          {r.mode !== 'tp' ? ` · ${SESSION_MODE_LABELS[r.mode]}` : ''} · {formatDate(r.createdAt)}
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">{r.unitTitle}</h1>
          <Button variant="tertiary" icon={<Download className="size-4" />} onClick={exportPdf} className="no-print">
            Exporter en PDF
          </Button>
        </div>
        <div className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {r.score !== null && (
            <p className="text-3xl font-semibold tracking-tight tabular-nums">
              {r.score}
              <span className="text-lg text-ink-3">/20</span>
            </p>
          )}
          <Stat icon={<CheckCircle2 className="size-4 text-green-600" />}>{plural(counts.correct, 'juste')}</Stat>
          <Stat icon={<XCircle className="size-4 text-red-600" />}>{plural(counts.wrong, 'fausse')}</Stat>
          <Stat icon={<MinusCircle className="size-4 text-yellow-600" />}>{plural(counts.skipped, 'passée')}</Stat>
          <Stat icon={<Clock className="size-4 text-ink-4" />}>{formatMinutes(totalTime)} de travail</Stat>
        </div>
      </header>

      <div className="space-y-4">
        <Callout tone="green" icon={<ThumbsUp className="size-4" />} title="Points forts">
          <Markdown className="text-sm">{r.strengthsMd || '—'}</Markdown>
        </Callout>
        <Callout tone="yellow" icon={<Flame className="size-4" />} title="Points bloquants">
          {r.blockingPoints.length === 0 ? (
            <p className="text-sm">Aucun point bloquant relevé. Bravo !</p>
          ) : (
            <ul className="space-y-2">
              {r.blockingPoints.map((b, i) => (
                <li key={i} className="text-sm">
                  <p className="font-semibold">{b.notion}</p>
                  <Markdown>{b.descriptionMd}</Markdown>
                </li>
              ))}
            </ul>
          )}
        </Callout>
        {r.overallMd && (
          <div className="print-break px-1">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">Bilan global</h2>
            <Markdown className="max-w-[65ch]">{r.overallMd}</Markdown>
          </div>
        )}
      </div>

      <div className="mt-8">
        <ReviewQuizProposal report={r} onStart={() => reviewQuiz.mutate()} starting={reviewQuiz.isPending} error={reviewQuiz.error} />
      </div>

      <h2 className="mt-16 mb-4 text-xs font-semibold tracking-wide text-ink-3 uppercase">Question par question</h2>
      <div className="space-y-1">
        {r.questions.map((q) => (
          <QuestionReport key={q.questionId} q={q} />
        ))}
      </div>
    </Page>
  );
}

function Stat({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-2">
      {icon}
      {children}
    </span>
  );
}

/** Quiz de révision facultatif : proposé à la fin du bilan, préparé seulement si l'étudiant le lance. */
function ReviewQuizProposal({ report, onStart, starting, error }: { report: ReportDto; onStart: () => void; starting: boolean; error: unknown }) {
  const navigate = useNavigate();
  const { reviewQuiz } = report;
  if (reviewQuiz.quizId) {
    return (
      <Callout
        tone="blue"
        icon={<Sparkles className="size-4" />}
        title="Ton quiz de révision est prêt"
        className="no-print"
        aside={
          <Button variant="primary" onClick={() => navigate(`/quizzes/${reviewQuiz.quizId}`)}>
            Ouvrir le quiz
          </Button>
        }
      />
    );
  }
  return (
    <div className="no-print space-y-2">
      <Callout
        tone="blue"
        icon={<Sparkles className="size-4" />}
        title={reviewQuiz.noStruggle ? 'Un petit quiz pour consolider ?' : `Un quiz de révision sur ce qui t’a posé problème ? (${reviewQuiz.proposedSize} questions)`}
        aside={
          <div className="flex gap-2">
            <Button variant="tertiary" onClick={() => navigate(`/courses/${report.courseId}`)}>
              Plus tard
            </Button>
            <Button variant="primary" loading={starting} onClick={onStart}>
              Lancer le quiz
            </Button>
          </div>
        }
      >
        <p className="text-sm">C’est facultatif : le quiz n’est préparé que si tu le lances, et tu pourras le faire plus tard depuis ce bilan.</p>
      </Callout>
      <ErrorBox error={error} />
    </div>
  );
}

const STATUS_TAG = {
  correct: { label: 'Juste', tone: 'green', icon: <CheckCircle2 className="size-3" /> },
  wrong: { label: 'Faux', tone: 'red', icon: <XCircle className="size-3" /> },
  other: { label: 'Sans réponse', tone: 'yellow', icon: <MinusCircle className="size-3" /> },
} satisfies Record<string, { label: string; tone: Tone; icon: ReactNode }>;

const statusTag = (status: QuestionStatus) => STATUS_TAG[status === 'correct' || status === 'wrong' ? status : 'other'];

/** Détail d'une question (replié) : énoncé, réponses et erreurs, explications et solution. */
function QuestionReport({ q }: { q: ReportQuestion }) {
  const st = statusTag(q.status);
  return (
    <Toggle
      className="print-break"
      summary={
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="truncate">
            {q.exerciseTitle} <span className="text-ink-3">· Question {q.label}</span>
          </span>
          <span className="flex items-center gap-2">
            {q.score !== null && (
              <span className="text-xs text-ink-3 tabular-nums">
                {q.score}/{q.maxScore} pt
              </span>
            )}
            <Tag tone={st.tone}>
              {st.icon} {st.label}
            </Tag>
          </span>
        </span>
      }
    >
      <div className="max-w-[65ch] space-y-6 pb-8">
        <div className="space-y-2">
          <QuestionStatement contextMd={q.contextMd} statementMd={q.statementMd} compact />
          <p className="text-xs text-ink-3">
            {formatMinutes(q.activeMs)} · {q.helps.length ? q.helps.join(' · ') : 'aucune aide'}
          </p>
        </div>

        {q.attempts.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Tes réponses</h3>
            {q.attempts.map((a, i) => (
              <div key={i} className="space-y-2">
                <p className="flex items-center gap-2 text-xs text-ink-3">
                  Essai {i + 1} <VerdictTag verdict={a.verdict} />
                </p>
                <AnswerView answer={a} />
                {(a.errorLocation || a.errorExplanation) && (
                  <Callout tone="red" icon={<XCircle className="size-4" />}>
                    {a.errorLocation && <p className="text-sm">Erreur : « {a.errorLocation} »</p>}
                    {a.errorExplanation && <Markdown className="mt-1 text-sm">{a.errorExplanation}</Markdown>}
                  </Callout>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">Explications</h3>
          <Markdown>{q.explanationMd}</Markdown>
        </div>
        <Callout
          tone="green"
          icon={<CheckCircle2 className="size-4" />}
          title="Solution"
          aside={<span className="text-xs">{q.solutionSource === 'official' ? 'd’après le corrigé officiel' : 'rédigée par l’IA'}</span>}
        >
          <Markdown className="text-sm">{q.solutionMd}</Markdown>
        </Callout>
      </div>
    </Toggle>
  );
}
