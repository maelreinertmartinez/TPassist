// Une question de quiz : énoncé, choix du QCM ou réponse libre, puis correction et explication une fois répondue.
import type { QuizItemDto } from '@tpassist/shared';
import clsx from 'clsx';
import { CheckCircle2, Flame, XCircle } from 'lucide-react';
import { Markdown } from '../../components/Markdown';
import { Button, Callout, ErrorBox, Tag, TextArea } from '../../components/ui';

/** Réponse en cours de saisie : choix du QCM ou texte libre. */
export type QuizDraft = { choice?: number; text?: string };

/** Choix du QCM ; une fois répondu, la bonne réponse est en vert et un mauvais choix en rouge. */
function McqChoices({ item, choice, onChoose }: { item: QuizItemDto; choice: number | undefined; onChoose: (i: number) => void }) {
  return (
    <div className="space-y-2" role="radiogroup">
      {item.choices.map((c, i) => {
        const selected = (item.answered ? item.userChoice : choice) === i;
        const isRight = item.answered && item.correctIndex === i;
        const isWrongPick = item.answered && selected && !isRight;
        return (
          <button
            type="button"
            key={i}
            role="radio"
            aria-checked={selected}
            disabled={item.answered}
            onClick={() => onChoose(i)}
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
  );
}

/** Correction d'une question répondue : verdict, retour de l'IA, réponse attendue et explication. */
function QuizFeedback({ item }: { item: QuizItemDto }) {
  return (
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
  );
}

interface Props {
  item: QuizItemDto;
  /** Numéro affiché (à partir de 1). */
  number: number;
  draft: QuizDraft | undefined;
  onDraft: (draft: QuizDraft) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: unknown;
}

export function QuizQuestion({ item, number, draft, onDraft, onSubmit, submitting, error }: Props) {
  const canSubmit = item.type === 'mcq' ? draft?.choice !== undefined : Boolean(draft?.text?.trim());
  return (
    <>
      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
          Question {number} · {item.type === 'mcq' ? 'QCM' : 'question ouverte'}
          {item.weakPointNotion && (
            <Tag tone="yellow">
              <Flame className="size-3" /> {item.weakPointNotion}
            </Tag>
          )}
        </p>
        <Markdown className="text-base">{item.promptMd}</Markdown>
      </div>

      {item.type === 'mcq' ? (
        <McqChoices item={item} choice={draft?.choice} onChoose={(choice) => onDraft({ choice })} />
      ) : item.answered ? (
        <div className="rounded-lg bg-block px-4 py-3">
          <p className="mb-1 text-xs font-semibold tracking-wide text-ink-3 uppercase">Ta réponse</p>
          <Markdown className="text-sm">{item.userAnswer ?? ''}</Markdown>
        </div>
      ) : (
        <TextArea rows={4} value={draft?.text ?? ''} onChange={(e) => onDraft({ text: e.target.value })} placeholder="Ta réponse (LaTeX : $...$)" />
      )}

      {item.answered ? (
        <QuizFeedback item={item} />
      ) : (
        <Button variant="primary" loading={submitting} disabled={!canSubmit} onClick={onSubmit}>
          Valider
        </Button>
      )}
      <ErrorBox error={error} />
    </>
  );
}
