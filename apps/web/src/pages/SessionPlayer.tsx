import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SESSION_MODE_LABELS,
  type AttemptDto,
  type HeartbeatResponse,
  type HelpEventDto,
  type HelpKind,
  type LockInfo,
  type LocksDto,
  type SessionState,
  type SubmitAttemptResponse,
} from '@tpassist/shared';
import clsx from 'clsx';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Flag,
  Image as ImageIcon,
  Lightbulb,
  Lock,
  MessageCircleQuestion,
  MessageSquareText,
  SearchCheck,
  Timer,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnswerPanel, draftToBody, emptyDraft, type AnswerDraft } from '../components/AnswerPanel';
import { ChatPanel } from '../components/ChatPanel';
import { HelpCard } from '../components/HelpCards';
import { Markdown } from '../components/Markdown';
import { Badge, Button, Card, ErrorBox, Modal, Spinner } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { formatClock, formatDuration } from '../lib/format';
import { postSse } from '../lib/sse';
import { useLockClock } from '../lib/useLockClock';

const HEARTBEAT_MS = 5000;

export function SessionPlayer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
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

  const [locks, setLocks] = useState<LocksDto | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [streaming, setStreaming] = useState<{ kind: HelpKind; text: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [struggleOpen, setStruggleOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);

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

  // Chronomètre local des EI (entre deux signaux).
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
    mutationFn: (struggled?: boolean) => api.post<SessionState>(`/api/sessions/${sessionId}/close-question`, { questionId, struggled }),
    onSuccess: (st) => {
      setStruggleOpen(false);
      setState(st);
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
    onSuccess: (st) => {
      setFinishOpen(false);
      setState(st);
    },
  });

  const onNext = () => {
    if (!current) return;
    if (current.attempts.length === 0) setStruggleOpen(true);
    else close.mutate(undefined);
  };

  // ---------- Rendu ----------
  if (state.isLoading) return <div className="p-8"><Spinner label="Chargement de la session…" /></div>;
  if (state.error || !s) return <div className="p-8"><ErrorBox error={state.error ?? 'Session introuvable'} /></div>;

  if (s.session.status !== 'in_progress') {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <Spinner className="justify-center" label="" />
        <h1 className="mt-4 text-xl font-semibold">Séance terminée !</h1>
        <p className="mt-2 text-sm text-muted">L’IA prépare ton bilan détaillé (réponses, erreurs, solutions et points bloquants). Cela peut prendre une ou deux minutes.</p>
        <Link to={`/courses/${s.session.courseId}`} className="mt-6 inline-block text-sm text-accent hover:underline">
          Retour au cours
        </Link>
      </div>
    );
  }

  const index = s.outline.findIndex((o) => o.id === s.currentQuestionId);
  const timeLeft = s.session.timeLimitSec ? s.session.timeLimitSec - elapsedSec : null;
  const lastAttempt = current?.attempts[current.attempts.length - 1];
  const hasCorrect = current?.attempts.some((a) => a.verdict === 'correct');
  const events = current?.events ?? [];
  const solutionEvent = events.find((e) => e.kind === 'solution');

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
      {/* En-tête */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/courses/${s.session.courseId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft className="size-4" /> {s.session.courseName}
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold">
            {s.session.unitTitle}
            {s.session.mode !== 'tp' && <Badge tone={isExam ? 'bad' : 'accent'}>{SESSION_MODE_LABELS[s.session.mode]}</Badge>}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {timeLeft !== null && (
            <span className={clsx('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-sm', timeLeft < 300 ? 'border-bad/40 bg-bad-soft text-bad' : 'border-border bg-surface')}>
              <Timer className="size-4" /> {formatClock(Math.max(0, timeLeft))}
            </span>
          )}
          {!isExam && (
            <Button icon={<MessageCircleQuestion className="size-4" />} onClick={() => setChatOpen(true)}>
              Poser une question
            </Button>
          )}
          {isExam && (
            <Button variant="danger" icon={<Flag className="size-4" />} onClick={() => setFinishOpen(true)}>
              Terminer l’épreuve
            </Button>
          )}
        </div>
      </div>

      {/* Progression */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        <span className="mr-2 text-sm text-muted">
          Question {index + 1}/{s.outline.length}
        </span>
        {s.outline.map((o, i) => (
          <button
            key={o.id}
            disabled={!isExam}
            onClick={() => goto.mutate(o.id)}
            title={`${o.exerciseTitle} — ${o.label}`}
            className={clsx(
              'h-2 w-6 rounded-full transition-colors',
              o.id === s.currentQuestionId ? 'bg-accent' : o.status === 'correct' ? 'bg-ok' : o.status === 'wrong' ? 'bg-bad' : o.status === 'skipped' ? 'bg-warn' : o.answered ? 'bg-accent/50' : 'bg-surface-2 ring-1 ring-border',
              isExam && 'cursor-pointer hover:brightness-110',
            )}
            aria-label={`Question ${i + 1}`}
          />
        ))}
      </div>

      {current && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          {/* Colonne gauche : énoncé + aides */}
          <div className="space-y-4">
            <Card className="p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge tone="accent">{current.question.exerciseTitle}</Badge>
                <Badge>Question {current.question.label}</Badge>
                {current.question.points != null && <Badge>{current.question.points} pt</Badge>}
              </div>
              {current.question.contextMd.trim() && (
                <div className="mb-4 rounded-lg bg-surface-2 px-4 py-3">
                  <Markdown className="text-[15px]">{current.question.contextMd}</Markdown>
                </div>
              )}
              <Markdown className="text-[15px]">{current.question.statementMd}</Markdown>
              {current.question.figures.length > 0 && (
                <details className="mt-4 rounded-lg border border-border">
                  <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
                    <ImageIcon className="size-4 text-muted" /> Figure{current.question.figures.length > 1 ? 's' : ''} (p. {current.question.figures.map((f) => f.page).join(', ')})
                  </summary>
                  <div className="space-y-2 p-2">
                    {current.question.figures.map((f) => (
                      <img key={f.page} src={f.url} alt={`Page ${f.page}`} className="w-full rounded-md border border-border" />
                    ))}
                  </div>
                </details>
              )}
            </Card>

            {current.closed ? null : !isExam ? (
              <HelpActions
                locks={locks}
                remaining={remaining}
                events={events}
                busy={streaming?.kind ?? null}
                onHelp={runHelp}
                onNext={onNext}
                nextLoading={close.isPending}
                hasCorrect={Boolean(hasCorrect)}
              />
            ) : null}

            <ErrorBox error={actionError} />

            {!isExam && (
              <div className="space-y-3">
                {events
                  .filter((e) => e.kind !== 'error_location' && e.kind !== 'error_explanation' && !(current.closed && e.kind === 'solution'))
                  .map((e) => (
                    <HelpCard key={e.id} kind={e.kind as HelpKind} contentMd={e.contentMd} courseRefs={e.courseRefs} solutionSource={e.solutionSource} />
                  ))}
                {streaming && !current.closed && <HelpCard kind={streaming.kind} contentMd={streaming.text} streaming />}
              </div>
            )}
          </div>

          {/* Colonne droite : réponse / vérification / transition */}
          <div className="space-y-4">
            {current.closed ? (
              <Transition
                attempts={current.attempts}
                solution={solutionEvent}
                streaming={streaming?.kind === 'solution' ? streaming.text : null}
                onLoadSolution={() => runHelp('solution')}
                onContinue={() => advance.mutate()}
                continuing={advance.isPending}
                isLast={s.outline.every((o) => o.id === current.question.id || o.status !== 'unseen' && o.status !== 'seen')}
              />
            ) : (
              <>
                <Card className="p-5">
                  <h2 className="mb-3 font-semibold">{isExam ? 'Ta réponse' : 'Ta solution'}</h2>
                  {hasCorrect && !isExam ? (
                    <CorrectBox onNext={() => close.mutate(undefined)} loading={close.isPending} />
                  ) : (
                    <AnswerPanel
                      draft={draft}
                      onChange={setDraft}
                      onSubmit={() => submit.mutate()}
                      submitting={submit.isPending}
                      submitLabel={isExam ? (current.attempts.length ? 'Remplacer ma réponse' : 'Enregistrer ma réponse') : 'Vérifier ma réponse'}
                    />
                  )}
                  {submit.isPending && !isExam && <p className="mt-2 text-center text-xs text-muted">L’IA vérifie ta réponse…</p>}
                </Card>

                {isExam ? (
                  <ExamNav
                    answered={current.attempts.length > 0}
                    canPrev={index > 0}
                    canNext={index < s.outline.length - 1}
                    onPrev={() => goto.mutate(s.outline[index - 1].id)}
                    onNext={() => advance.mutate()}
                    onFinish={() => setFinishOpen(true)}
                  />
                ) : (
                  lastAttempt &&
                  lastAttempt.verdict !== 'correct' &&
                  lastAttempt.verdict !== 'pending' && (
                    <WrongBox
                      attempt={lastAttempt}
                      locks={locks}
                      remaining={remaining}
                      solutionShown={Boolean(solutionEvent)}
                      onReveal={(what) => reveal.mutate({ attemptId: lastAttempt.id, what })}
                      revealing={reveal.isPending}
                      onSolution={() => runHelp('solution')}
                      solutionLoading={streaming?.kind === 'solution'}
                    />
                  )
                )}
                {!isExam && current.attempts.length > 1 && <AttemptHistory attempts={current.attempts.slice(0, -1)} />}
              </>
            )}
          </div>
        </div>
      )}

      <Modal
        open={struggleOpen}
        onClose={() => setStruggleOpen(false)}
        title="Avant de passer à la suite…"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStruggleOpen(false)}>
              Rester sur la question
            </Button>
            <Button onClick={() => close.mutate(false)} loading={close.isPending && close.variables === false}>
              Non, ça allait
            </Button>
            <Button variant="primary" onClick={() => close.mutate(true)} loading={close.isPending && close.variables === true}>
              Oui, j’ai galéré
            </Button>
          </>
        }
      >
        <p className="text-sm">Tu n’as pas proposé de réponse. As-tu eu du mal avec cette question ?</p>
        <p className="mt-2 text-sm text-muted">Ta réponse sert à cibler le quiz de révision et les points bloquants. La solution expliquée s’affichera ensuite.</p>
      </Modal>

      <Modal
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        title="Terminer l’épreuve ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFinishOpen(false)}>
              Continuer l’épreuve
            </Button>
            <Button variant="danger" loading={finish.isPending} onClick={() => finish.mutate()}>
              Terminer et obtenir ma note
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {s.outline.filter((o) => !o.answered).length > 0
            ? `${s.outline.filter((o) => !o.answered).length} question(s) sans réponse. `
            : 'Toutes les questions ont une réponse. '}
          Une fois terminée, l’épreuve est corrigée et notée sur 20.
        </p>
      </Modal>

      {!isExam && (
        <ChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          threadUrl={`/api/sessions/${sessionId}/chat`}
          subtitle={`${s.session.unitTitle}${current ? ` — question ${current.question.label}` : ''}`}
          onSent={() => state.refetch()}
        />
      )}
    </div>
  );
}

// ---------- Sous-composants ----------

function LockedLabel({ ms, lock }: { ms: number | null; lock: LockInfo | null | undefined }) {
  if (ms === 0) return null;
  if (ms === null) return <span className="text-xs font-normal text-muted">{lock?.reason ?? 'verrouillé'}</span>;
  return <span className="font-mono text-xs font-normal text-muted">dans {formatDuration(ms)}</span>;
}

function ActionButton({ icon, label, onClick, disabled, loading, extra, done }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; loading?: boolean; extra?: ReactNode; done?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={clsx(
        'flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm font-medium transition-colors',
        disabled ? 'cursor-not-allowed border-border bg-surface-2/50 text-muted' : 'border-border bg-surface hover:border-accent hover:bg-accent-soft',
      )}
    >
      <span className="flex items-center gap-2.5">
        {loading ? <Spinner /> : disabled ? <Lock className="size-4" /> : icon}
        {label}
        {done && <CheckCircle2 className="size-3.5 text-ok" />}
      </span>
      {extra}
    </button>
  );
}

function HelpActions({
  locks,
  remaining,
  events,
  busy,
  onHelp,
  onNext,
  nextLoading,
  hasCorrect,
}: {
  locks: LocksDto | null;
  remaining: (l: LockInfo | null | undefined) => number | null;
  events: HelpEventDto[];
  busy: HelpKind | null;
  onHelp: (k: HelpKind) => void;
  onNext: () => void;
  nextLoading: boolean;
  hasCorrect: boolean;
}) {
  const has = (k: HelpKind) => events.some((e) => e.kind === k);
  const hintMs = remaining(locks?.hint);
  const solMs = remaining(locks?.solution);
  return (
    <Card className="space-y-2 p-3">
      <ActionButton icon={<MessageSquareText className="size-4 text-accent" />} label="1. Reformuler l’énoncé" onClick={() => onHelp('reformulation')} loading={busy === 'reformulation'} done={has('reformulation')} disabled={Boolean(busy) && busy !== 'reformulation'} />
      <ActionButton icon={<BookOpen className="size-4 text-[#0891b2]" />} label="2. Partie de cours utile" onClick={() => onHelp('course_refs')} loading={busy === 'course_refs'} done={has('course_refs')} disabled={Boolean(busy) && busy !== 'course_refs'} />
      <ActionButton
        icon={<Lightbulb className="size-4 text-warn" />}
        label="3. Une indication"
        onClick={() => onHelp('hint')}
        loading={busy === 'hint'}
        done={has('hint')}
        disabled={hintMs !== 0 || (Boolean(busy) && busy !== 'hint')}
        extra={!has('hint') && <LockedLabel ms={hintMs} lock={locks?.hint} />}
      />
      <ActionButton
        icon={<CheckCircle2 className="size-4 text-ok" />}
        label="4. La solution"
        onClick={() => onHelp('solution')}
        loading={busy === 'solution'}
        done={has('solution')}
        disabled={solMs !== 0 || (Boolean(busy) && busy !== 'solution')}
        extra={!has('solution') && <LockedLabel ms={solMs} lock={locks?.solution} />}
      />
      <ActionButton icon={<ArrowRight className="size-4 text-muted" />} label={hasCorrect ? '5. Question suivante' : '5. Passer à la question suivante'} onClick={onNext} loading={nextLoading} disabled={Boolean(busy)} />
    </Card>
  );
}

function CorrectBox({ onNext, loading }: { onNext: () => void; loading: boolean }) {
  return (
    <div className="space-y-3 rounded-xl border border-ok/40 bg-ok-soft px-4 py-4 text-ok">
      <p className="flex items-center gap-2 text-lg font-semibold">
        <CheckCircle2 className="size-5" /> Correct, bravo !
      </p>
      <p className="text-sm">Ta réponse est juste. Passe à la question suivante : la solution complète te sera montrée pour comparer.</p>
      <Button variant="success" onClick={onNext} loading={loading} icon={<ArrowRight className="size-4" />}>
        Question suivante
      </Button>
    </div>
  );
}

function highlight(text: string, needle: string | undefined): ReactNode {
  if (!needle) return text;
  const i = text.indexOf(needle.trim());
  if (i < 0) return text;
  const n = needle.trim();
  return (
    <>
      {text.slice(0, i)}
      <mark className="error-mark">{n}</mark>
      {text.slice(i + n.length)}
    </>
  );
}

function WrongBox({
  attempt,
  locks,
  remaining,
  onReveal,
  revealing,
  onSolution,
  solutionShown,
  solutionLoading,
}: {
  attempt: AttemptDto;
  locks: LocksDto | null;
  remaining: (l: LockInfo | null | undefined) => number | null;
  onReveal: (what: 'location' | 'explanation') => void;
  revealing: boolean;
  onSolution: () => void;
  solutionShown: boolean;
  solutionLoading: boolean;
}) {
  const chain = locks?.error?.attemptId === attempt.id ? locks.error : null;
  const showMs = remaining(chain?.showError);
  const explainMs = remaining(chain?.explainError);
  const solMs = solutionShown ? 0 : remaining(chain?.solution);
  const answerText = attempt.type === 'code' ? attempt.code : attempt.text;
  const located = attempt.revealed.location !== undefined;
  const found = located && answerText && attempt.revealed.location && answerText.includes(attempt.revealed.location.trim());

  return (
    <Card className="space-y-4 border-bad/40 p-5">
      <div className="flex items-center gap-2 text-bad">
        <XCircle className="size-5" />
        <p className="text-lg font-semibold">{attempt.verdict === 'partiel' ? 'Partiellement faux' : 'Faux'}</p>
      </div>
      <p className="text-sm text-muted">Ta réponse n’est pas correcte : il y a encore quelque chose à revoir. Relis ta démarche, réessaie, ou utilise les aides ci-dessous.</p>

      {located && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Où est l’erreur :</p>
          {attempt.type === 'image' ? (
            <div className="space-y-2">
              {attempt.imageUrl && <img src={attempt.imageUrl} alt="Ta copie" className="max-h-64 rounded-lg border border-border" />}
              <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{attempt.revealed.location}</p>
            </div>
          ) : found ? (
            <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm whitespace-pre-wrap">{highlight(answerText!, attempt.revealed.location)}</pre>
          ) : (
            <blockquote className="rounded-lg border-l-4 border-bad bg-bad-soft px-3 py-2 text-sm text-bad">{attempt.revealed.location}</blockquote>
          )}
        </div>
      )}

      {attempt.revealed.explanation !== undefined && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Explication de l’erreur :</p>
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            <Markdown className="text-sm">{attempt.revealed.explanation}</Markdown>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {!located && (
          <ActionButton icon={<Eye className="size-4 text-bad" />} label="Montrer où est l’erreur" onClick={() => onReveal('location')} loading={revealing} disabled={showMs !== 0} extra={<LockedLabel ms={showMs} lock={chain?.showError} />} />
        )}
        {attempt.revealed.explanation === undefined && (
          <ActionButton
            icon={<SearchCheck className="size-4 text-bad" />}
            label="Expliquer l’erreur"
            onClick={() => onReveal('explanation')}
            loading={revealing && located}
            disabled={!located || explainMs !== 0}
            extra={<LockedLabel ms={located ? explainMs : null} lock={located ? chain?.explainError : { unlocked: false, remainingMs: null, reason: 'Montre d’abord l’erreur.' }} />}
          />
        )}
        {!solutionShown && (
          <ActionButton
            icon={<CheckCircle2 className="size-4 text-ok" />}
            label="Donner la solution"
            onClick={onSolution}
            loading={solutionLoading}
            disabled={solMs !== 0}
            extra={<LockedLabel ms={solMs} lock={chain?.solution} />}
          />
        )}
      </div>
    </Card>
  );
}

function AttemptHistory({ attempts }: { attempts: AttemptDto[] }) {
  return (
    <details className="rounded-xl border border-border bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Tentatives précédentes ({attempts.length})</summary>
      <div className="space-y-3 border-t border-border px-4 py-3">
        {attempts.map((a, i) => (
          <div key={a.id} className="space-y-1">
            <p className="flex items-center gap-2 text-xs text-muted">
              Tentative {i + 1} <Badge tone={a.verdict === 'correct' ? 'ok' : 'bad'}>{a.verdict === 'correct' ? 'juste' : a.verdict === 'partiel' ? 'partielle' : 'fausse'}</Badge>
            </p>
            {a.type === 'image' && a.imageUrl ? (
              <img src={a.imageUrl} alt="" className="max-h-40 rounded-md border border-border" />
            ) : (
              <pre className="max-h-40 overflow-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-xs whitespace-pre-wrap">{a.type === 'code' ? a.code : a.text}</pre>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function Transition({
  attempts,
  solution,
  streaming,
  onLoadSolution,
  onContinue,
  continuing,
  isLast,
}: {
  attempts: AttemptDto[];
  solution?: HelpEventDto;
  streaming: string | null;
  onLoadSolution: () => void;
  onContinue: () => void;
  continuing: boolean;
  isLast: boolean;
}) {
  const requested = useRef(false);
  useEffect(() => {
    if (!solution && !requested.current) {
      requested.current = true;
      onLoadSolution();
    }
  }, [solution]);
  const firstTry = attempts.length > 0 && attempts[0].verdict === 'correct';
  const correct = attempts.some((a) => a.verdict === 'correct');
  return (
    <div className="space-y-4">
      <div className={clsx('rounded-xl border px-4 py-3 text-sm', correct ? 'border-ok/40 bg-ok-soft text-ok' : 'border-border bg-surface-2')}>
        {firstTry
          ? 'Ta réponse était juste dès le premier essai : voici la solution complète pour comparer.'
          : correct
            ? 'Tu as trouvé la bonne réponse : relis la solution complète pour consolider.'
            : 'Voici la solution complète et expliquée de cette question. Prends le temps de la comprendre avant de continuer.'}
      </div>
      {solution ? (
        <HelpCard kind="solution" contentMd={solution.contentMd} solutionSource={solution.solutionSource} />
      ) : (
        <HelpCard kind="solution" contentMd={streaming ?? ''} streaming />
      )}
      <Button variant="primary" className="w-full" onClick={onContinue} loading={continuing} disabled={!solution} icon={<ChevronRight className="size-4" />}>
        {isLast ? 'Terminer et voir mon bilan' : 'Continuer'}
      </Button>
    </div>
  );
}

function ExamNav({ answered, canPrev, canNext, onPrev, onNext, onFinish }: { answered: boolean; canPrev: boolean; canNext: boolean; onPrev: () => void; onNext: () => void; onFinish: () => void }) {
  return (
    <Card className="space-y-3 p-4">
      {answered && (
        <p className="flex items-center gap-2 text-sm text-ok">
          <CheckCircle2 className="size-4" /> Réponse enregistrée. Tu peux la remplacer tant que l’épreuve n’est pas terminée.
        </p>
      )}
      <div className="flex justify-between gap-2">
        <Button disabled={!canPrev} onClick={onPrev} icon={<ChevronLeft className="size-4" />}>
          Précédente
        </Button>
        {canNext ? (
          <Button variant="primary" onClick={onNext}>
            Suivante <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Button variant="danger" onClick={onFinish} icon={<Flag className="size-4" />}>
            Terminer l’épreuve
          </Button>
        )}
      </div>
    </Card>
  );
}
