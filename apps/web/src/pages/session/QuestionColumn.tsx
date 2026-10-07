// Colonne de gauche du lecteur : l'énoncé, les aides obtenues juste dessous, puis le bouton d'aide successif.
import type { CurrentQuestionState, HelpKind, LockInfo, LocksDto } from '@tpassist/shared';
import { Image as ImageIcon, MessageSquareText, SkipForward } from 'lucide-react';
import { HELP_META, HelpCard, type HelpKindShown } from '../../components/HelpCards';
import { QuestionStatement } from '../../components/QuestionStatement';
import { HelpStepButton } from '../../components/StepButtons';
import { ErrorBox, TextAction, Toggle } from '../../components/ui';

const SHOWN_KINDS = (Object.keys(HELP_META) as HelpKindShown[]).sort((a, b) => HELP_META[a].order - HELP_META[b].order);

interface Props {
  current: CurrentQuestionState;
  isExam: boolean;
  locks: LocksDto | null;
  remaining: (l: LockInfo | null | undefined) => number | null;
  /** Aide en cours de rédaction, avec le texte déjà reçu. */
  streaming: { kind: HelpKind; text: string } | null;
  onHelp: (kind: HelpKind) => void;
  /** null : le bouton « Passer la question » est masqué (question déjà réussie). */
  onSkip: (() => void) | null;
  skipping: boolean;
  error: string | null;
}

/** Énoncé, aides et bouton d’aide de la question en cours. */
export function QuestionColumn({ current, isExam, locks, remaining, streaming, onHelp, onSkip, skipping, error }: Props) {
  const { question, events } = current;
  const helpsAllowed = !isExam;
  return (
    <article className="min-w-0 max-w-[65ch] space-y-6">
      <div className="space-y-4">
        <p className="text-sm text-ink-3">
          {question.exerciseTitle} · Question {question.label}
          {question.points != null && ` · ${question.points} pt`}
        </p>
        <QuestionStatement contextMd={question.contextMd} statementMd={question.statementMd} />
        {question.figures.length > 0 && (
          <Toggle
            summary={
              <span className="inline-flex items-center gap-2 text-ink-2">
                <ImageIcon className="size-4 text-ink-4" />
                {question.figures.length > 1 ? 'Figures' : 'Figure'} du sujet (p. {question.figures.map((f) => f.page).join(', ')})
              </span>
            }
          >
            <div className="space-y-2">
              {question.figures.map((f) => (
                <img key={f.page} src={f.url} alt={`Page ${f.page}`} className="w-full rounded-lg" />
              ))}
            </div>
          </Toggle>
        )}
        {helpsAllowed && !current.closed && !events.some((e) => e.kind === 'reformulation') && streaming?.kind !== 'reformulation' && (
          <TextAction icon={<MessageSquareText className="size-4" />} onClick={() => onHelp('reformulation')} disabled={Boolean(streaming)} className="-ml-2">
            Reformuler l’énoncé
          </TextAction>
        )}
      </div>

      {helpsAllowed && (events.length > 0 || streaming) && (
        <div className="space-y-3">
          {SHOWN_KINDS.map((kind) => {
            const ev = events.find((e) => e.kind === kind);
            if (ev) return <HelpCard key={kind} kind={kind} contentMd={ev.contentMd} courseRefs={ev.courseRefs} solutionSource={ev.solutionSource} />;
            if (streaming?.kind === kind) return <HelpCard key={kind} kind={kind} contentMd={streaming.text} streaming />;
            return null;
          })}
        </div>
      )}

      {helpsAllowed && !current.closed && (
        <div className="flex flex-wrap items-center gap-2">
          <HelpStepButton events={events} locks={locks} remaining={remaining} busy={streaming?.kind ?? null} onHelp={onHelp} />
          {onSkip && (
            <TextAction icon={<SkipForward className="size-4" />} onClick={onSkip} disabled={Boolean(streaming) || skipping}>
              Passer la question
            </TextAction>
          )}
        </div>
      )}

      <ErrorBox error={error} />
    </article>
  );
}
