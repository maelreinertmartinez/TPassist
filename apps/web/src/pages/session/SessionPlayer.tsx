// Lecteur de séance (TD, TP ou EI) : une question à la fois, l'énoncé et les aides à gauche, la réponse à droite.
// Cette page ne fait que la mise en page : l'état et les actions viennent de useSession.
import { PartyPopper } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChatPanel } from '../../components/ChatPanel';
import { ErrorBox, Page, Spinner } from '../../components/ui';
import { useBreadcrumbs } from '../../lib/breadcrumbs';
import { AnswerAside } from './AnswerAside';
import { QuestionColumn } from './QuestionColumn';
import { SessionToolbar } from './SessionToolbar';
import { StruggleModal } from './StruggleModal';
import { useSession } from './useSession';

/** Lecteur de séance (route /sessions/:sessionId). */
export function SessionPlayer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const ctl = useSession(sessionId);
  const { query, session: s, current } = ctl;
  const [chatOpen, setChatOpen] = useState(false);

  useBreadcrumbs(s ? [{ label: s.session.courseName, to: `/courses/${s.session.courseId}` }, { label: s.session.unitTitle }] : []);

  if (query.isLoading) return <Page width="narrow" spacious><Spinner label="Chargement de la séance…" /></Page>;
  if (query.error || !s) return <Page width="narrow" spacious><ErrorBox error={query.error ?? 'Séance introuvable'} /></Page>;
  if (!ctl.inProgress) return <SessionFinished courseId={s.session.courseId} />;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:pb-4">
      <h1 className="sr-only">{s.session.unitTitle}</h1>
      <SessionToolbar session={s} ctl={ctl} onOpenChat={() => setChatOpen(true)} />

      {current && (
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <QuestionColumn
            current={current}
            isExam={ctl.isExam}
            locks={ctl.locks}
            remaining={ctl.remaining}
            streaming={ctl.streaming}
            onHelp={ctl.runHelp}
            onSkip={current.attempts.some((a) => a.verdict === 'correct') ? null : ctl.onSkip}
            skipping={ctl.close.isPending}
            error={ctl.actionError}
          />
          <AnswerAside ctl={ctl} session={s} current={current} />
        </div>
      )}

      <StruggleModal ctl={ctl} />

      {!ctl.isExam && (
        <ChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          threadUrl={`/api/sessions/${sessionId}/chat`}
          subtitle={`${s.session.unitTitle}${current ? ` · question ${current.question.label}` : ''}`}
          onSent={() => query.refetch()}
        />
      )}
    </div>
  );
}

/** Séance terminée : le bilan est en préparation (la page y redirige dès qu'il est prêt). */
function SessionFinished({ courseId }: { courseId: string }) {
  return (
    <Page width="narrow" spacious>
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-tint-green text-tint-green-icon">
          <PartyPopper className="size-6" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">Séance terminée</h1>
        <p className="max-w-md text-sm text-ink-3">L’IA prépare ton bilan : chaque question, tes réponses, tes erreurs expliquées et tes points bloquants. Cela prend une ou deux minutes.</p>
        <Spinner label="Préparation du bilan…" />
        <Link to={`/courses/${courseId}`} className="text-sm text-ink-3 hover:text-ink hover:underline">
          Retour au cours
        </Link>
      </div>
    </Page>
  );
}
