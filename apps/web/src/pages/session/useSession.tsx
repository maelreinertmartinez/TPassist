// État et actions du lecteur de séance : état venu du serveur, signal de présence, verrous, brouillons de réponse,
// aides diffusées au fil de l'eau et actions (répondre, dévoiler l'erreur, passer, avancer, terminer).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HelpEventDto, HelpKind, LocksDto, SessionState, SubmitAttemptResponse } from '@tpassist/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { draftToBody, emptyDraft, type AnswerDraft } from '../../components/AnswerPanel';
import { useConfirm } from '../../components/ui';
import { api, ApiError, errorMessage } from '../../lib/api';
import { postSse } from '../../lib/sse';
import { useLockClock } from '../../lib/useLockClock';
import { useHeartbeat, useSessionClock } from './useHeartbeat';

/**
 * Pilote une séance : la page et ses panneaux ne font qu'afficher ce que renvoie ce hook.
 * Le serveur reste maître de l'état (verrous, statut des questions) ; chaque action renvoie ou recharge l'état.
 */
export function useSession(sessionId: string | undefined) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const key = ['session', sessionId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get<SessionState>(`/api/sessions/${sessionId}`),
    refetchInterval: (q) => (q.state.data?.session.status === 'reporting' ? 2000 : false),
  });
  const setState = (st: SessionState) => qc.setQueryData(key, st);

  const s = query.data;
  const current = s?.current ?? null;
  const questionId = current?.question.id ?? null;
  const isExam = s?.session.mode === 'ei_examen';
  const inProgress = s?.session.status === 'in_progress';

  const [locks, setLocks] = useState<LocksDto | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [streaming, setStreaming] = useState<{ kind: HelpKind; text: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [struggleOpen, setStruggleOpen] = useState(false);
  const [elapsedSec, setElapsedSec] = useSessionClock(s?.session.elapsedSec, Boolean(s?.session.timeLimitSec) && inProgress);
  const showError = (e: unknown) => setActionError(errorMessage(e));

  useEffect(() => {
    if (current) setLocks(current.locks);
    setActionError(null);
  }, [current]);

  // Bilan prêt : on y va.
  useEffect(() => {
    if (s && !inProgress && s.session.reportId) navigate(`/reports/${s.session.reportId}`, { replace: true });
  }, [s?.session.status, s?.session.reportId]);

  const beat = useHeartbeat(sessionId, questionId, inProgress, (r) => {
    if (r.locks) setLocks(r.locks);
    setElapsedSec(r.elapsedSec);
    if (r.timeUp || r.status !== 'in_progress') void query.refetch();
  });
  const remaining = useLockClock(locks);

  const draft = (questionId && drafts[questionId]) || emptyDraft();
  const setDraft = (d: AnswerDraft) => questionId && setDrafts((cur) => ({ ...cur, [questionId]: d }));

  /** Demande une aide ; le texte arrive au fil de l'eau dans `streaming`. */
  const runHelp = async (kind: HelpKind) => {
    if (!questionId || streaming) return;
    setActionError(null);
    setStreaming({ kind, text: '' });
    try {
      // Le temps actif est envoyé d'abord : c'est lui qui débloque l'aide côté serveur.
      await beat();
      await postSse<HelpEventDto>(`/api/sessions/${sessionId}/help`, { questionId, kind }, { onDelta: (t) => setStreaming((cur) => (cur ? { ...cur, text: cur.text + t } : cur)) });
      await query.refetch();
      setTimeout(() => document.getElementById(`help-${kind}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    } catch (err) {
      showError(err);
    } finally {
      setStreaming(null);
    }
  };

  const submit = useMutation({
    mutationFn: () => api.post<SubmitAttemptResponse>(`/api/sessions/${sessionId}/attempts`, draftToBody(questionId!, draft)),
    onSuccess: async (r) => {
      setLocks(r.locks);
      await query.refetch();
    },
    onError: showError,
  });
  const reveal = useMutation({
    mutationFn: (v: { attemptId: string; what: 'location' | 'explanation' }) => api.post(`/api/sessions/${sessionId}/attempts/${v.attemptId}/reveal`, { what: v.what }),
    onMutate: () => beat(),
    onSuccess: () => query.refetch(),
    onError: showError,
  });
  const close = useMutation({
    mutationFn: (v: { struggled?: boolean; skip?: boolean }) => api.post<SessionState>(`/api/sessions/${sessionId}/close-question`, { questionId, struggled: v.struggled, skip: v.skip }),
    onSuccess: (st, v) => {
      setStruggleOpen(false);
      setState(st);
      if (v.skip) window.scrollTo({ top: 0 });
    },
    // Passer sans avoir répondu : le serveur demande d'abord « As-tu galéré ? ».
    onError: (e) => (e instanceof ApiError && e.code === 'struggle_required' ? setStruggleOpen(true) : showError(e)),
  });
  const advance = useMutation({
    mutationFn: () => api.post<SessionState>(`/api/sessions/${sessionId}/advance`),
    onSuccess: (st) => {
      setState(st);
      window.scrollTo({ top: 0 });
    },
    onError: showError,
  });
  const goto = useMutation({ mutationFn: (qid: string) => api.post<SessionState>(`/api/sessions/${sessionId}/goto`, { questionId: qid }), onSuccess: setState });
  const finish = useMutation({ mutationFn: () => api.post<SessionState>(`/api/sessions/${sessionId}/finish`), onSuccess: setState });

  /** « Passer la question » : sans réponse, on demande d'abord si l'étudiant a eu du mal. */
  const onSkip = () => {
    if (!current) return;
    if (current.attempts.length === 0) setStruggleOpen(true);
    else close.mutate({ skip: true });
  };

  /** Termine une EI après confirmation (les réponses ne sont plus modifiables ensuite). */
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

  // Question fermée après une bonne réponse : la solution expliquée est affichée automatiquement avant de continuer.
  const solutionShown = Boolean(current?.events.some((e) => e.kind === 'solution'));
  const autoSolutionFor = useRef<string | null>(null);
  useEffect(() => {
    if (current?.closed && !solutionShown && autoSolutionFor.current !== current.question.id && !streaming) {
      autoSolutionFor.current = current.question.id;
      void runHelp('solution');
    }
  }, [current?.closed, current?.question.id, solutionShown]);

  return {
    query,
    session: s,
    current,
    isExam,
    inProgress,
    locks,
    remaining,
    elapsedSec,
    draft,
    setDraft,
    streaming,
    actionError,
    struggleOpen,
    setStruggleOpen,
    solutionShown,
    runHelp,
    submit,
    reveal,
    close,
    advance,
    goto,
    onSkip,
    onFinishExam,
  };
}

/** Ce que renvoie useSession : passé tel quel aux composants du lecteur. */
export type SessionController = ReturnType<typeof useSession>;
