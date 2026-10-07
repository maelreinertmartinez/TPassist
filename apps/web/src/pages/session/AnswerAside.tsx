// Panneau de droite du lecteur (« Ta solution »), collant et presque pleine hauteur. Il change selon l'état de la question :
// transition après la question, réponse d'EI (mode examen), réponse juste, ou réponse à donner (avec l'erreur précédente).
import type { CurrentQuestionState, SessionState } from '@tpassist/shared';
import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { AnswerPanel, canSubmitDraft } from '../../components/AnswerPanel';
import { ErrorStepButton } from '../../components/StepButtons';
import { Button, Callout } from '../../components/ui';
import { AnswerReadOnly, AttemptHistory, WrongCallout } from './answers';
import { PanelBody, PanelFooter, TransitionPanel } from './panels';
import { FinishExamButton } from './SessionToolbar';
import type { SessionController } from './useSession';

interface Props {
  ctl: SessionController;
  session: SessionState;
  current: CurrentQuestionState;
}

/** Bouton d'envoi de la réponse (désactivé tant que le brouillon est vide). */
function SubmitButton({ ctl, label }: { ctl: SessionController; label: string }) {
  return (
    <Button variant="primary" size="lg" className="w-full" disabled={!canSubmitDraft(ctl.draft)} loading={ctl.submit.isPending} onClick={() => ctl.submit.mutate()}>
      {label}
    </Button>
  );
}

/** EI en mode examen : la réponse est enregistrée sans correction, et on navigue librement entre les questions. */
function ExamPanel({ ctl, session: s, current }: Props) {
  const index = s.outline.findIndex((o) => o.id === s.currentQuestionId);
  return (
    <>
      <PanelBody title="Ta réponse">
        {current.attempts.length > 0 && (
          <Callout tone="green" icon={<CheckCircle2 className="size-4" />}>
            <p className="text-sm">Réponse enregistrée. Tu peux la remplacer tant que l’épreuve n’est pas terminée.</p>
          </Callout>
        )}
        <AnswerPanel draft={ctl.draft} onChange={ctl.setDraft} onSubmit={() => ctl.submit.mutate()} />
      </PanelBody>
      <PanelFooter>
        <SubmitButton ctl={ctl} label={current.attempts.length ? 'Remplacer ma réponse' : 'Enregistrer ma réponse'} />
        <div className="flex justify-between gap-2">
          <Button variant="tertiary" icon={<ChevronLeft className="size-4" />} disabled={index <= 0} onClick={() => ctl.goto.mutate(s.outline[index - 1].id)}>
            Précédente
          </Button>
          {index < s.outline.length - 1 ? (
            <Button variant="tertiary" onClick={() => ctl.advance.mutate()}>
              Suivante <ChevronRight className="size-4" />
            </Button>
          ) : (
            <FinishExamButton onClick={ctl.onFinishExam} />
          )}
        </div>
      </PanelFooter>
    </>
  );
}

/** Réponse juste : on passe à la suite, où la solution complète sera montrée pour comparer. */
function CorrectPanel({ ctl, current }: Omit<Props, 'session'>) {
  const last = current.attempts[current.attempts.length - 1];
  return (
    <>
      <PanelBody title="Ta solution">
        <Callout tone="green" icon={<CheckCircle2 className="size-4" />} title="Correct, bravo !">
          <p className="text-sm">Ta réponse est juste. Passe à la suite : la solution complète te sera montrée pour comparer.</p>
        </Callout>
        {last && <AnswerReadOnly attempt={last} />}
      </PanelBody>
      <PanelFooter>
        <Button variant="primary" size="lg" className="w-full" icon={<ArrowRight className="size-4" />} loading={ctl.close.isPending} onClick={() => ctl.close.mutate({})}>
          Question suivante
        </Button>
      </PanelFooter>
    </>
  );
}

/** Réponse à donner ; après une réponse fausse, l'erreur est détaillée pas à pas au-dessus de l'éditeur. */
function AnsweringPanel({ ctl, current }: Omit<Props, 'session'>) {
  const { attempts } = current;
  const last = attempts[attempts.length - 1];
  return (
    <>
      <PanelBody title="Ta solution" aside={attempts.length > 0 && <span className="text-xs text-ink-3">{attempts.length + 1}e essai</span>}>
        {last && last.verdict !== 'correct' && last.verdict !== 'pending' && (
          <WrongCallout
            attempt={last}
            solutionShown={ctl.solutionShown}
            action={
              <ErrorStepButton
                attempt={last}
                locks={ctl.locks}
                remaining={ctl.remaining}
                solutionShown={ctl.solutionShown}
                loading={ctl.reveal.isPending || ctl.streaming?.kind === 'solution'}
                onReveal={(what) => ctl.reveal.mutate({ attemptId: last.id, what })}
                onSolution={() => ctl.runHelp('solution')}
              />
            }
          />
        )}
        <AnswerPanel draft={ctl.draft} onChange={ctl.setDraft} onSubmit={() => ctl.submit.mutate()} />
        {attempts.length > 1 && <AttemptHistory attempts={attempts.slice(0, -1)} />}
      </PanelBody>
      <PanelFooter>
        <SubmitButton ctl={ctl} label={ctl.submit.isPending ? 'L’IA vérifie ta réponse…' : 'Vérifier ma réponse'} />
      </PanelFooter>
    </>
  );
}

export function AnswerAside({ ctl, session: s, current }: Props) {
  // Dernière question : toutes les autres sont déjà traitées.
  const isLast = s.outline.every((o) => o.id === current.question.id || (o.status !== 'unseen' && o.status !== 'seen'));
  return (
    <aside className="flex min-h-96 flex-col self-start rounded-lg bg-raised shadow-e3 lg:sticky lg:top-28 lg:h-[calc(100dvh-8rem)]">
      {current.closed ? (
        <TransitionPanel attempts={current.attempts} ready={ctl.solutionShown} isLast={isLast} continuing={ctl.advance.isPending} onContinue={() => ctl.advance.mutate()} />
      ) : ctl.isExam ? (
        <ExamPanel ctl={ctl} session={s} current={current} />
      ) : current.attempts.some((a) => a.verdict === 'correct') ? (
        <CorrectPanel ctl={ctl} current={current} />
      ) : (
        <AnsweringPanel ctl={ctl} current={current} />
      )}
    </aside>
  );
}
