// Retours visuels : encadrés, étiquettes, chargement, erreurs, progression et états vides.
import clsx from 'clsx';
import { Loader2, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './buttons';

/** Teintes des encadrés et étiquettes (chacune a son fond, son texte et sa couleur d'icône). */
export type Tone = 'grey' | 'blue' | 'green' | 'red' | 'yellow';

const TONE_CLASSES: Record<Tone, { box: string; icon: string }> = {
  grey: { box: 'bg-tint-grey text-tint-grey-ink', icon: 'text-tint-grey-icon' },
  blue: { box: 'bg-tint-blue text-tint-blue-ink', icon: 'text-tint-blue-icon' },
  green: { box: 'bg-tint-green text-tint-green-ink', icon: 'text-tint-green-icon' },
  red: { box: 'bg-tint-red text-tint-red-ink', icon: 'text-tint-red-icon' },
  yellow: { box: 'bg-tint-yellow text-tint-yellow-ink', icon: 'text-tint-yellow-icon' },
};

/** Encadré à la Notion : icône, titre, action à droite (`aside`) et contenu. */
export function Callout({
  tone = 'grey',
  icon,
  title,
  aside,
  children,
  className,
  id,
}: {
  tone?: Tone;
  icon?: ReactNode;
  title?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  const t = TONE_CLASSES[tone];
  // L'icône est centrée sur la ligne du titre : même hauteur (24 px, ou 32 px si un bouton l'accompagne à droite).
  const rowHeight = aside ? 'h-8' : 'h-6';
  return (
    <div id={id} className={clsx('print-break flex gap-3 rounded-lg px-4 py-3', t.box, className)}>
      {icon && <span className={clsx('flex shrink-0 items-center', rowHeight, t.icon)}>{icon}</span>}
      <div className="min-w-0 flex-1">
        {(title || aside) && (
          <div className={clsx('flex flex-wrap items-center justify-between gap-2', aside ? 'min-h-8' : 'min-h-6')}>
            {title && <p className="text-sm font-semibold">{title}</p>}
            {aside}
          </div>
        )}
        {children && <div className={clsx(title && 'mt-1')}>{children}</div>}
      </div>
    </div>
  );
}

/** Petite étiquette colorée (statut, type…). */
export function Tag({ tone = 'grey', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded px-2 text-xs leading-6 whitespace-nowrap', TONE_CLASSES[tone].box, className)}>{children}</span>;
}

/** Indicateur de chargement, avec un texte optionnel. */
export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2 text-sm text-ink-3', className)}>
      <Loader2 className="size-4 animate-spin" />
      {label}
    </span>
  );
}

/** Erreur dans un encadré rouge (rien si `error` est vide), avec un bouton « Réessayer » optionnel. */
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <Callout
      tone="red"
      aside={
        onRetry && (
          <Button size="sm" variant="tertiary" onClick={onRetry}>
            Réessayer
          </Button>
        )
      }
    >
      <p className="text-sm">{error instanceof Error ? error.message : String(error)}</p>
    </Callout>
  );
}

/** Barre de progression fine ; `value` entre 0 et 1. `onTint` : sur un fond coloré. */
export function ProgressBar({ value, className, onTint }: { value: number; className?: string; onTint?: boolean }) {
  return (
    <div className={clsx('h-1 w-full overflow-hidden rounded-full', onTint ? 'bg-page' : 'bg-hover', className)}>
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

/** Anneau de progression pour un compte à rebours (accompagné du temps en texte) ; `progress` entre 0 et 1. */
export function CountdownRing({ progress, className }: { progress: number; className?: string }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <svg viewBox="0 0 16 16" className={clsx('size-4 shrink-0 -rotate-90', className)} aria-hidden>
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={c} strokeDashoffset={c * (1 - p)} strokeLinecap="round" />
    </svg>
  );
}

/** Aide encore verrouillée : cadenas et explication. */
export function LockedHint({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-3">
      <Lock className="size-4 text-ink-4" />
      {children}
    </span>
  );
}

/** État vide centré : icône, titre, explication et action principale. */
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && <span className="grid size-12 place-items-center rounded-full bg-tint-blue text-tint-blue-icon">{icon}</span>}
      <p className="text-base font-semibold">{title}</p>
      {children && <div className="max-w-md text-sm text-ink-3">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
