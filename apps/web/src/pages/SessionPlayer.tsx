import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SESSION_MODE_LABELS,
  type AttemptDto,
  type HeartbeatResponse,
  type HelpEventDto,
  type HelpKind,
  type LocksDto,
  type OutlineItem,
  type SessionState,
  type SubmitAttemptResponse,
} from '@tpassist/shared';
import clsx from 'clsx';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Flag,
  Image as ImageIcon,
  MessageCircleQuestion,
  MessageSquareText,
  PartyPopper,
  SkipForward,
  Timer,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnswerPanel, canSubmitDraft, draftToBody, emptyDraft, type AnswerDraft } from '../components/AnswerPanel';
import { ChatPanel } from '../components/ChatPanel';
import { HELP_META, HelpCard, type HelpKindShown } from '../components/HelpCards';
import { Markdown } from '../components/Markdown';
import { ErrorStepButton, HelpStepButton } from '../components/StepButtons';
import { Button, Callout, ErrorBox, Modal, Spinner, Tag, TextAction, Toggle, useConfirm } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { useBreadcrumbs } from '../lib/breadcrumbs';
import { formatClock } from '../lib/format';
import { postSse } from '../lib/sse';
import { useLockClock } from '../lib/useLockClock';

const HEARTBEAT_MS = 5000;

export function SessionPlayer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const key = ['session', sessionId];
  const state = useQuery({
    queryKey: key,
    queryFn: () => api.get<SessionState>(`/api/sessions/${sessionId}`),
    refetchInterval: (q) => (q.state.data?.session.status === 'reporting' ? 2000 : false),
  });
  const setState = (s: SessionState) => qc.setQueryData(key, s);

  const s = state.data;
  const current = s?.current ?? null;
  const questionId = current?.question.id ?? null;
  const isExam = s?.session.mode === 'ei_examen';

  useBreadcrumbs(s ? [{ label: s.session.courseName, to: `/courses/${s.session.courseId}` }, { label: s.session.unitTitle }] : []);

  const [locks, setLocks] = useState<LocksDto | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [streaming, setStreaming] = useState<{ kind: HelpKind; text: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [struggleOpen, setStruggleOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    if (current) setLocks(current.locks);
    setActionError(null);
  }, [current]);
  useEffect(() => {
    if (s) setElapsedSec(s.session.elapsedSec);
  }, [s?.session.elapsedSec]);

  // Bilan prêt : on y va.
  useEffect(() => {
    if (s && s.session.status !== 'in_progress' && s.session.reportId) navigate(`/reports/${s.session.reportId}`, { replace: true });
  }, [s?.session.status, s?.session.reportId]);

  // ---------- Signal de présence (temps actif + chronomètre) ----------
  const beat = useCallback(async () => {
    if (!s || s.session.status !== 'in_progress') return;
    try {
      const r = await api.post<HeartbeatResponse>(`/api/sessions/${sessionId}/heartbeat`, {
        questionId,
        visible: document.visibilityState === 'visible',
      });
      if (r.locks) setLocks(r.locks);
      setElapsedSec(r.elapsedSec);
      if (r.timeUp || r.status !== 'in_progress') state.refetch();
    } catch {
      // réseau : on réessaiera au prochain battement
    }
  }, [sessionId, questionId, s?.session.status]);

  useEffect(() => {
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    const onVis = () => beat();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [beat]);

  useEffect(() => {
    if (!s?.session.timeLimitSec || s.session.status !== 'in_progress') return;
    const id = setInterval(() => setElapsedSec((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [s?.session.timeLimitSec, s?.session.status]);

  const remaining = useLockClock(locks);

  // ---------- Actions ----------
  const draft = (questionId && drafts[questionId]) || emptyDraft();
  const setDraft = (d: AnswerDraft) => questionId && setDrafts((cur) => ({ ...cur, [questionId]: d }));

  const runHelp = async (kind: HelpKind) => {
    if (!questionId || streaming) return;
    setActionError(null);
    setStreaming({ kind, text: '' });
    try {
      await beat();
      await postSse<HelpEventDto>(`/api/sessions/${sessionId}/help`, { questionId, kind }, { onDelta: (t) => setStreaming((cur) => (cur ? { ...cur, text: cur.text + t } : cur)) });
      await state.refetch();
      setTimeout(() => document.getElementById(`help-${kind}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setStreaming(null);
    }
  };

  const submit = useMutation({
    mutationFn: () => api.post<SubmitAttemptResponse>(`/api/sessions/${sessionId}/attempts`, draftToBody(questionId!, draft)),
    onSuccess: async (r) => {
      setLocks(r.locks);
      await state.refetch();
    },
    onError: (e) => setActionError(errorMessage(e)),
  });

  const reveal = useMutation({
    mutationFn: (v: { attemptId: string; what: 'location' | 'explanation' }) => api.post(`/api/sessions/${sessionId}/attempts/${v.attemptId}/reveal`, { what: v.what }),
    onMutate: () => beat(),
    onSuccess: () => state.refetch(),
    onError: (e) => setActionError(errorMessage(e)),
  });

  const close = useMutation({
    mutationFn: (v: { struggled?: boolean; skip?: boolean }) =>
      api.post<SessionState>(`/api/sessions/${sessionId}/close-question`, { questionId, struggled: v.struggled, skip: v.skip }),
    onSuccess: (st, v) => {
      setStruggleOpen(false);
      setState(st);
      if (v.skip) window.scrollTo({ top: 0 });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'struggle_required') setStruggleOpen(true);
      else setActionError(errorMessage(e));
    },
  });

  const advance = useMutation({
    mutationFn: () => api.post<SessionState>(`/api/sessions/${sessionId}/advance`),
    onSuccess: (st) => {
      setState(st);
      window.scrollTo({ top: 0 });
    },
    onError: (e) => setActionError(errorMessage(e)),
  });
  const goto = useMutation({
    mutationFn: (qid: string) => api.post<SessionState>(`/api/sessions/${sessionId}/goto`, { questionId: qid }),
    onSuccess: (st) => setState(st),
  });
  const finish = useMutation({
    mutationFn: () => api.post<SessionState>(`/api/sessions/${sessionId}/finish`),
    onSuccess: (st) => setState(st),
  });

  const onSkip = () => {
    if (!current) return;
    if (current.attempts.length === 0) setStruggleOpen(true);
    else close.mutate({ skip: true });
  };

  const onFinishExam = async () => {
    const missing = s?.outline.filter((o) => !o.answered).length ?? 0;
    const ok = await confirm({
      title: 'Terminer l’épreuve ?',
      message: (
        <>
          {missing > 0 ? `${missing} question(s) n’ont pas de réponse. ` : 'Toutes les questions ont une réponse. '}
          Une fois terminée, l’épreuve est corrigée et notée sur 20 : tu ne pourras plus modifier tes réponses.
        </>
      ),
      confirmLabel: 'Terminer et obtenir ma note',
      danger: true,
    });
    if (ok) finish.mutate();
  };

  // Transition : la solution expliquée est toujours affichée avant de continuer.
  const solutionEvent = current?.events.find((e) => e.kind === 'solution');
  const autoSolutionFor = useRef<string | null>(null);
  useEffect(() => {
    if (current?.closed && !solutionEvent && autoSolutionFor.current !== current.question.id && !streaming) {
      autoSolutionFor.current = current.question.id;
      runHelp('solution');
    }
  }, [current?.closed, current?.question.id, solutionEvent]);

  // ---------- Rendu ----------
  if (state.isLoading) return <PageMessage><Spinner label="Chargement de la séance…" /></PageMessage>;
  if (state.error || !s) return <PageMessage><ErrorBox error={state.error ?? 'Séance introuvable'} /></PageMessage>;

  if (s.session.status !== 'in_progress') {
    return (
      <PageMessage>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-tint-green text-tint-green-icon">
            <PartyPopper className="size-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Séance terminée</h1>
          <p className="max-w-md text-sm text-ink-3">L’IA prépare ton bilan : chaque question, tes réponses, tes erreurs expliquées et tes points bloquants. Cela prend une ou deux minutes.</p>
          <Spinner label="Préparation du bilan…" />
          <Link to={`/courses/${s.session.courseId}`} className="text-sm text-ink-3 hover:text-ink hover:underline">
            Retour au cours
          </Link>
        </div>
      </PageMessage>
    );
  }

  const index = s.outline.findIndex((o) => o.id === s.currentQuestionId);
  const timeLeft = s.session.timeLimitSec ? s.session.timeLimitSec - elapsedSec : null;
  const attempts = current?.attempts ?? [];
  const lastAttempt = attempts[attempts.length - 1];
  const hasCorrect = attempts.some((a) => a.verdict === 'correct');
  const events = current?.events ?? [];
  const shownKinds = (Object.keys(HELP_META) as HelpKindShown[]).sort((a, b) => HELP_META[a].order - HELP_META[b].order);
  const isLast = s.outline.every((o) => o.id === current?.question.id || (o.status !== 'unseen' && o.status !== 'seen'));

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:pb-4">
      <h1 className="sr-only">{s.session.unitTitle}</h1>

      {/* Progression et actions de la séance */}
      <div className="no-print z-20 flex flex-wrap items-center justify-between gap-4 bg-page py-4 lg:sticky lg:top-12 lg:h-16 lg:py-0">
        <Progress outline={s.outline} currentId={s.currentQuestionId} index={index} canJump={isExam} onJump={(id) => goto.mutate(id)} />
        <div className="flex flex-wrap items-center gap-2">
          {s.session.mode !== 'tp' && <Tag tone={isExam ? 'red' : 'blue'}>{SESSION_MODE_LABELS[s.session.mode]}</Tag>}
          {timeLeft !== null && (
            <span
              className={clsx(
                'inline-flex h-8 items-center gap-2 rounded px-3 text-sm tabular-nums',
                timeLeft < 300 ? 'bg-tint-red text-tint-red-ink' : 'bg-block text-ink-2',
              )}
              title="Temps restant"
            >
              <Timer className="size-4" /> {formatClock(Math.max(0, timeLeft))}
            </span>
          )}
          {!isExam && (
            <Button variant="tertiary" icon={<MessageCircleQuestion className="size-4" />} onClick={() => setChatOpen(true)}>
              Poser une question
            </Button>
          )}
          {isExam && (
            <Button variant="danger-quiet" icon={<Flag className="size-4" />} onClick={onFinishExam}>
              Terminer l’épreuve
            </Button>
          )}
        </div>
      </div>

      {current && (
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          {/* Colonne gauche : énoncé, puis les aides juste dessous, puis le bouton d'aide */}
          <article className="min-w-0 max-w-[65ch] space-y-6">
            <div className="space-y-4">
              <p className="text-sm text-ink-3">
                {current.question.exerciseTitle} · Question {current.question.label}
                {current.question.points != null && ` · ${current.question.points} pt`}
              </p>
              {current.question.contextMd.trim() && (
                <div className="rounded-lg bg-block px-4 py-3">
                  <Markdown>{current.question.contextMd}</Markdown>
                </div>
              )}
              <Markdown className="text-base">{current.question.statementMd}</Markdown>
              {current.question.figures.length > 0 && (
                <Toggle
                  summary={
                    <span className="inline-flex items-center gap-2 text-ink-2">
                      <ImageIcon className="size-4 text-ink-4" />
                      Figure{current.question.figures.length > 1 ? 's' : ''} du sujet (p. {current.question.figures.map((f) => f.page).join(', ')})
                    </span>
                  }
                >
                  <div className="space-y-2">
                    {current.question.figures.map((f) => (
                      <img key={f.page} src={f.url} alt={`Page ${f.page}`} className="w-full rounded-lg" />
                    ))}
                  </div>
                </Toggle>
              )}
              {!isExam && !current.closed && !events.some((e) => e.kind === 'reformulation') && streaming?.kind !== 'reformulation' && (
                <TextAction icon={<MessageSquareText className="size-4" />} onClick={() => runHelp('reformulation')} disabled={Boolean(streaming)} className="-ml-2">
                  Reformuler l’énoncé
                </TextAction>
              )}
            </div>

            {!isExam && (events.length > 0 || streaming) && (
              <div className="space-y-3">
                {shownKinds.map((kind) => {
                  const ev = events.find((e) => e.kind === kind);
                  if (ev) return <HelpCard key={kind} kind={kind} contentMd={ev.contentMd} courseRefs={ev.courseRefs} solutionSource={ev.solutionSource} />;
                  if (streaming?.kind === kind) return <HelpCard key={kind} kind={kind} contentMd={streaming.text} streaming />;
                  return null;
                })}
              </div>
            )}

            {!isExam && !current.closed && (
              <div className="flex flex-wrap items-center gap-2">
                <HelpStepButton events={events} locks={locks} remaining={remaining} busy={streaming?.kind ?? null} onHelp={runHelp} />
                {!hasCorrect && (
                  <TextAction icon={<SkipForward className="size-4" />} onClick={onSkip} disabled={Boolean(streaming) || close.isPending}>
                    Passer la question
                  </TextAction>
                )}
              </div>
            )}

            <ErrorBox error={actionError} />
          </article>

          {/* Colonne droite : la réponse, collante et presque pleine hauteur */}
          <aside className="flex min-h-96 flex-col self-start rounded-lg bg-raised shadow-e3 lg:sticky lg:top-28 lg:h-[calc(100dvh-8rem)]">
            {current.closed ? (
              <TransitionPanel
                attempts={attempts}
                ready={Boolean(solutionEvent)}
                isLast={isLast}
                continuing={advance.isPending}
                onContinue={() => advance.mutate()}
              />
            ) : isExam ? (
              <>
                <PanelBody title="Ta réponse">
                  {attempts.length > 0 && (
                    <Callout tone="green" icon={<CheckCircle2 className="size-4" />}>
                      <p className="text-sm">Réponse enregistrée. Tu peux la remplacer tant que l’épreuve n’est pas terminée.</p>
                    </Callout>
                  )}
                  <AnswerPanel draft={draft} onChange={setDraft} onSubmit={() => submit.mutate()} />
                </PanelBody>
                <PanelFooter>
                  <Button variant="primary" size="lg" className="w-full" disabled={!canSubmitDraft(draft)} loading={submit.isPending} onClick={() => submit.mutate()}>
                    {attempts.length ? 'Remplacer ma réponse' : 'Enregistrer ma réponse'}
                  </Button>
                  <div className="flex justify-between gap-2">
                    <Button variant="tertiary" icon={<ChevronLeft className="size-4" />} disabled={index <= 0} onClick={() => goto.mutate(s.outline[index - 1].id)}>
                      Précédente
                    </Button>
                    {index < s.outline.length - 1 ? (
                      <Button variant="tertiary" onClick={() => advance.mutate()}>
                        Suivante <ChevronRight className="size-4" />
                      </Button>
                    ) : (
                      <Button variant="danger-quiet" icon={<Flag className="size-4" />} onClick={onFinishExam}>
                        Terminer l’épreuve
                      </Button>
                    )}
                  </div>
                </PanelFooter>
              </>
            ) : hasCorrect ? (
              <>
                <PanelBody title="Ta solution">
                  <Callout tone="green" icon={<CheckCircle2 className="size-4" />} title="Correct, bravo !">
                    <p className="text-sm">Ta réponse est juste. Passe à la suite : la solution complète te sera montrée pour comparer.</p>
                  </Callout>
                  {lastAttempt && <AnswerReadOnly attempt={lastAttempt} />}
                </PanelBody>
                <PanelFooter>
                  <Button variant="primary" size="lg" className="w-full" icon={<ArrowRight className="size-4" />} loading={close.isPending} onClick={() => close.mutate({})}>
                    Question suivante
                  </Button>
                </PanelFooter>
              </>
            ) : (
              <>
                <PanelBody title="Ta solution" aside={attempts.length > 0 && <span className="text-xs text-ink-3">{attempts.length + 1}e essai</span>}>
                  {lastAttempt && lastAttempt.verdict !== 'correct' && lastAttempt.verdict !== 'pending' && (
                    <WrongCallout
                      attempt={lastAttempt}
                      action={
                        <ErrorStepButton
                          attempt={lastAttempt}
                          locks={locks}
                          remaining={remaining}
                          solutionShown={Boolean(solutionEvent)}
                          loading={reveal.isPending || streaming?.kind === 'solution'}
                          onReveal={(what) => reveal.mutate({ attemptId: lastAttempt.id, what })}
                          onSolution={() => runHelp('solution')}
                        />
                      }
                      solutionShown={Boolean(solutionEvent)}
                    />
                  )}
                  <AnswerPanel draft={draft} onChange={setDraft} onSubmit={() => submit.mutate()} />
                  {attempts.length > 1 && <AttemptHistory attempts={attempts.slice(0, -1)} />}
                </PanelBody>
                <PanelFooter>
                  <Button variant="primary" size="lg" className="w-full" disabled={!canSubmitDraft(draft)} loading={submit.isPending} onClick={() => submit.mutate()}>
                    {submit.isPending ? 'L’IA vérifie ta réponse…' : 'Vérifier ma réponse'}
                  </Button>
                </PanelFooter>
              </>
            )}
          </aside>
        </div>
      )}

      <Modal
        open={struggleOpen}
        onClose={() => setStruggleOpen(false)}
        title="As-tu galéré sur cette question ?"
        footer={
          <>
            <Button variant="tertiary" onClick={() => setStruggleOpen(false)}>
              Rester sur la question
            </Button>
            <Button onClick={() => close.mutate({ struggled: false, skip: true })} loading={close.isPending && close.variables?.struggled === false}>
              Non, ça allait
            </Button>
            <Button variant="primary" onClick={() => close.mutate({ struggled: true, skip: true })} loading={close.isPending && close.variables?.struggled === true}>
              Oui, j’ai galéré
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">Tu passes sans avoir proposé de réponse. Ta réponse sert à cibler le quiz de révision et tes points bloquants. La solution de cette question sera dans ton bilan de fin.</p>
      </Modal>

      {!isExam && (
        <ChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          threadUrl={`/api/sessions/${sessionId}/chat`}
          subtitle={`${s.session.unitTitle}${current ? ` · question ${current.question.label}` : ''}`}
          onSent={() => state.refetch()}
        />
      )}
    </div>
  );
}

// ---------- Sous-composants ----------

function PageMessage({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-xl px-4 py-24">{children}</div>;
}

function PanelBody({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </div>
  );
}

function PanelFooter({ children }: { children: ReactNode }) {
  return <div className="space-y-2 border-t border-line p-4">{children}</div>;
}

const STATUS_META: Record<OutlineItem['status'], { label: string; bar: string }> = {
  correct: { label: 'juste', bar: 'bg-green-500' },
  wrong: { label: 'fausse', bar: 'bg-red-500' },
  skipped: { label: 'passée', bar: 'bg-yellow-500' },
  seen: { label: 'en cours', bar: 'bg-hover' },
  unseen: { label: 'à faire', bar: 'bg-hover' },
};

function Progress({ outline, currentId, index, canJump, onJump }: { outline: OutlineItem[]; currentId: string | null; index: number; canJump: boolean; onJump: (id: string) => void }) {
  const correct = outline.filter((o) => o.status === 'correct').length;
  const wrong = outline.filter((o) => o.status === 'wrong').length;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-sm font-semibold whitespace-nowrap">
        Question {index + 1} <span className="font-normal text-ink-3">sur {outline.length}</span>
      </span>
      <div className="flex min-w-32 max-w-sm flex-1 gap-1" aria-hidden={!canJump}>
        {outline.map((o, i) => {
          const isCurrent = o.id === currentId;
          const label = `Question ${i + 1} (${o.exerciseTitle} — ${o.label}) : ${isCurrent ? 'en cours' : STATUS_META[o.status].label}`;
          return (
            <button
              type="button"
              key={o.id}
              disabled={!canJump}
              title={label}
              aria-label={label}
              onClick={() => onJump(o.id)}
              className={clsx(
                'h-2 flex-1 rounded-full transition-colors',
                isCurrent ? 'bg-accent' : o.answered && o.status === 'seen' ? 'bg-blue-300' : STATUS_META[o.status].bar,
                canJump && 'cursor-pointer hover:opacity-75',
              )}
            />
          );
        })}
      </div>
      {(correct > 0 || wrong > 0) && (
        <span className="inline-flex items-center gap-3 text-sm text-ink-3">
          {correct > 0 && (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="size-4 text-green-600" /> {correct} juste{correct > 1 ? 's' : ''}
            </span>
          )}
          {wrong > 0 && (
            <span className="inline-flex items-center gap-1">
              <XCircle className="size-4 text-red-600" /> {wrong} fausse{wrong > 1 ? 's' : ''}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function highlight(text: string, needle: string | undefined): ReactNode {
  const n = needle?.trim();
  if (!n) return text;
  const i = text.indexOf(n);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="error-mark">{n}</mark>
      {text.slice(i + n.length)}
    </>
  );
}

function WrongCallout({ attempt, action, solutionShown }: { attempt: AttemptDto; action: ReactNode; solutionShown: boolean }) {
  const answerText = attempt.type === 'code' ? attempt.code : attempt.text;
  const location = attempt.revealed.location;
  const found = location !== undefined && answerText && location.trim() && answerText.includes(location.trim());
  return (
    <Callout tone="red" icon={<XCircle className="size-4" />} title={attempt.verdict === 'partiel' ? 'Pas tout à fait' : 'Faux'}>
      <div className="space-y-3">
        <p className="text-sm">Ta réponse n’est pas correcte. Relis ta démarche et réessaie, ou avance pas à pas avec le bouton ci-dessous.</p>
        {location !== undefined && (
          <div className="space-y-1">
            <p className="text-sm font-semibold">Où est l’erreur</p>
            {attempt.type === 'image' ? (
              <p className="rounded bg-page px-3 py-2 text-sm text-ink">{location}</p>
            ) : found ? (
              <pre className="max-h-48 overflow-auto rounded bg-page px-3 py-2 font-mono text-sm whitespace-pre-wrap text-ink">{highlight(answerText!, location)}</pre>
            ) : (
              <blockquote className="rounded bg-page px-3 py-2 text-sm text-ink">« {location} »</blockquote>
            )}
          </div>
        )}
        {attempt.revealed.explanation !== undefined && (
          <div className="space-y-1">
            <p className="text-sm font-semibold">Pourquoi c’est faux</p>
            <Markdown className="text-sm">{attempt.revealed.explanation}</Markdown>
          </div>
        )}
        {action && <div>{action}</div>}
        {solutionShown && (
          <button type="button" className="text-sm underline-offset-2 hover:underline" onClick={() => document.getElementById('help-solution')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            La solution est affichée sous l’énoncé →
          </button>
        )}
      </div>
    </Callout>
  );
}

function AnswerReadOnly({ attempt, title = 'Ta réponse' }: { attempt: AttemptDto; title?: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</p>
      {attempt.type === 'image' && attempt.imageUrl ? (
        <img src={attempt.imageUrl} alt="Ta copie" className="max-h-96 rounded-lg" />
      ) : attempt.type === 'code' ? (
        <pre className="overflow-auto rounded-lg bg-block px-4 py-3 font-mono text-sm whitespace-pre-wrap">{attempt.code}</pre>
      ) : (
        <div className="rounded-lg bg-block px-4 py-3">
          <Markdown className="text-sm">{attempt.text ?? ''}</Markdown>
        </div>
      )}
    </div>
  );
}

function AttemptHistory({ attempts }: { attempts: AttemptDto[] }) {
  return (
    <Toggle summary={<span className="text-ink-3">Essais précédents ({attempts.length})</span>}>
      <div className="space-y-4">
        {attempts.map((a, i) => (
          <div key={a.id} className="space-y-1">
            <p className="flex items-center gap-2 text-xs text-ink-3">
              Essai {i + 1}
              <Tag tone={a.verdict === 'correct' ? 'green' : 'red'}>
                {a.verdict === 'correct' ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                {a.verdict === 'correct' ? 'juste' : a.verdict === 'partiel' ? 'incomplet' : 'faux'}
              </Tag>
            </p>
            {a.type === 'image' && a.imageUrl ? (
              <img src={a.imageUrl} alt="" className="max-h-48 rounded" />
            ) : (
              <pre className="max-h-48 overflow-auto rounded bg-block px-3 py-2 font-mono text-xs whitespace-pre-wrap">{a.type === 'code' ? a.code : a.text}</pre>
            )}
          </div>
        ))}
      </div>
    </Toggle>
  );
}

function TransitionPanel({ attempts, ready, isLast, continuing, onContinue }: { attempts: AttemptDto[]; ready: boolean; isLast: boolean; continuing: boolean; onContinue: () => void }) {
  const firstTry = attempts.length > 0 && attempts[0].verdict === 'correct';
  const correct = attempts.some((a) => a.verdict === 'correct');
  const last = attempts[attempts.length - 1];
  return (
    <>
      <PanelBody title="Avant de continuer">
        <Callout tone={correct ? 'green' : 'blue'} icon={correct ? <CheckCircle2 className="size-4" /> : <CircleDashed className="size-4" />}>
          <p className="text-sm">
            {firstTry
              ? 'Juste dès le premier essai ! Compare ta démarche avec la solution complète, affichée sous l’énoncé.'
              : correct
                ? 'Tu as trouvé la bonne réponse. Relis la solution complète, sous l’énoncé, pour consolider.'
                : 'Prends le temps de comprendre la solution expliquée, affichée sous l’énoncé, avant de continuer.'}
          </p>
        </Callout>
        {last && <AnswerReadOnly attempt={last} title="Ta dernière réponse" />}
      </PanelBody>
      <PanelFooter>
        <Button variant="primary" size="lg" className="w-full" onClick={onContinue} loading={continuing} disabled={!ready} icon={<ChevronRight className="size-4" />}>
          {ready ? (isLast ? 'Terminer et voir mon bilan' : 'Continuer') : 'Préparation de la solution…'}
        </Button>
      </PanelFooter>
    </>
  );
}
