// Boutons « successifs » du lecteur : un bouton d'aide (cours → indice → solution) et un bouton d'erreur
// (montrer → expliquer → solution), avec leurs comptes à rebours.
import { nextErrorStep, nextHelpStep, type AttemptDto, type HelpEventDto, type HelpKind, type LockInfo, type LocksDto } from '@tpassist/shared';
import { BookOpen, CheckCircle2, Eye, Lightbulb, SearchCheck } from 'lucide-react';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { formatDuration } from '../lib/format';
import { Button, CountdownRing, LockedHint, type ButtonVariant } from './ui';

type Remaining = (l: LockInfo | null | undefined) => number | null;

interface StepDef {
  icon: ReactNode;
  label: string;
  /** Libellé pendant l'attente : « Indication disponible ». */
  waiting: string;
}

/**
 * Un seul bouton dont l'état avance : prêt (cliquable), en attente (compte à rebours + anneau),
 * ou bloqué par un prérequis (raison affichée). Le serveur reste maître des verrous.
 */
function StepButton({
  def,
  lock,
  remaining,
  delayMs,
  loading,
  disabled,
  variant = 'secondary',
  onClick,
}: {
  def: StepDef;
  lock: LockInfo | null;
  remaining: Remaining;
  delayMs: number;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  onClick: () => void;
}) {
  const ms = remaining(lock);
  if (ms === 0 || loading) {
    return (
      <Button variant={variant} icon={def.icon} loading={loading} disabled={disabled} onClick={onClick}>
        {def.label}
      </Button>
    );
  }
  if (ms === null) return <LockedHint>{lock?.reason ?? `${def.waiting} bientôt`}</LockedHint>;
  return (
    <span
      className={clsx('inline-flex h-8 items-center gap-2 rounded px-3 text-sm', variant === 'raised' ? 'bg-page text-ink-2' : 'bg-block text-ink-3')}
      role="status"
      aria-live="polite"
    >
      <CountdownRing progress={delayMs ? 1 - ms / delayMs : 0} className="text-accent" />
      {def.waiting} dans <span className="tabular-nums">{formatDuration(ms)}</span>
    </span>
  );
}

const HELP_STEPS: Record<'course_refs' | 'hint' | 'solution', StepDef> = {
  course_refs: { icon: <BookOpen className="size-4" />, label: 'Voir la partie de cours utile', waiting: 'Partie de cours disponible' },
  hint: { icon: <Lightbulb className="size-4" />, label: 'Obtenir une indication', waiting: 'Indication disponible' },
  solution: { icon: <CheckCircle2 className="size-4" />, label: 'Voir la solution', waiting: 'Solution disponible' },
};

/** Bouton d'aide unique : partie de cours → indication → solution. */
export function HelpStepButton({
  events,
  locks,
  remaining,
  busy,
  onHelp,
}: {
  events: HelpEventDto[];
  locks: LocksDto | null;
  remaining: Remaining;
  busy: HelpKind | null;
  onHelp: (k: HelpKind) => void;
}) {
  const { step, lock } = nextHelpStep(events, locks);
  if (step === 'done') return null;
  return (
    <StepButton
      def={HELP_STEPS[step]}
      lock={lock}
      remaining={remaining}
      delayMs={locks?.delayMs ?? 0}
      loading={busy === step}
      disabled={Boolean(busy)}
      onClick={() => onHelp(step)}
    />
  );
}

const ERROR_STEPS: Record<'location' | 'explanation' | 'solution', StepDef> = {
  location: { icon: <Eye className="size-4" />, label: 'Montrer où est l’erreur', waiting: 'Localisation de l’erreur disponible' },
  explanation: { icon: <SearchCheck className="size-4" />, label: 'Expliquer l’erreur', waiting: 'Explication disponible' },
  solution: { icon: <CheckCircle2 className="size-4" />, label: 'Donner la solution', waiting: 'Solution disponible' },
};

/** Bouton d'erreur unique : montrer → expliquer → donner la solution. */
export function ErrorStepButton({
  attempt,
  locks,
  remaining,
  solutionShown,
  loading,
  onReveal,
  onSolution,
}: {
  attempt: AttemptDto;
  locks: LocksDto | null;
  remaining: Remaining;
  solutionShown: boolean;
  loading: boolean;
  onReveal: (what: 'location' | 'explanation') => void;
  onSolution: () => void;
}) {
  const { step, lock } = nextErrorStep(attempt, locks, solutionShown);
  if (step === 'done') return null;
  return (
    <StepButton
      def={ERROR_STEPS[step]}
      lock={lock}
      remaining={remaining}
      delayMs={locks?.delayMs ?? 0}
      loading={loading}
      variant="raised"
      onClick={() => (step === 'solution' ? onSolution() : onReveal(step))}
    />
  );
}
