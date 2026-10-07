// Réponses déjà envoyées dans le lecteur : réponse fausse détaillée pas à pas, réponse en lecture seule, essais précédents.
import type { AttemptDto } from '@tpassist/shared';
import { XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { AnswerView, VerdictTag } from '../../components/attempts';
import { Markdown } from '../../components/Markdown';
import { Callout, Toggle } from '../../components/ui';

/** Surligne la première occurrence de `needle` dans `text`. */
function highlight(text: string, needle: string): ReactNode {
  const i = text.indexOf(needle);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="error-mark">{needle}</mark>
      {text.slice(i + needle.length)}
    </>
  );
}

/**
 * Réponse fausse : seul « Faux » est affiché, puis l'emplacement de l'erreur (surligné dans la réponse quand c'est
 * possible) et son explication, au fur et à mesure qu'ils sont dévoilés par `action` (le bouton d'erreur).
 */
export function WrongCallout({ attempt, action, solutionShown }: { attempt: AttemptDto; action: ReactNode; solutionShown: boolean }) {
  const answerText = attempt.type === 'code' ? attempt.code : attempt.text;
  const location = attempt.revealed.location;
  const needle = location?.trim();
  const found = Boolean(needle && answerText?.includes(needle));
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
              <pre className="max-h-48 overflow-auto rounded bg-page px-3 py-2 font-mono text-sm whitespace-pre-wrap text-ink">{highlight(answerText!, needle!)}</pre>
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

/** Réponse envoyée, en lecture seule. */
export function AnswerReadOnly({ attempt, title = 'Ta réponse' }: { attempt: AttemptDto; title?: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{title}</p>
      <AnswerView answer={attempt} />
    </div>
  );
}

/** Essais précédents, repliés. */
export function AttemptHistory({ attempts }: { attempts: AttemptDto[] }) {
  return (
    <Toggle summary={<span className="text-ink-3">Essais précédents ({attempts.length})</span>}>
      <div className="space-y-4">
        {attempts.map((a, i) => (
          <div key={a.id} className="space-y-1">
            <p className="flex items-center gap-2 text-xs text-ink-3">
              Essai {i + 1} <VerdictTag verdict={a.verdict} />
            </p>
            <AnswerView answer={a} compact />
          </div>
        ))}
      </div>
    </Toggle>
  );
}
