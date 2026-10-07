// Boutons : hiérarchie primaire / secondaire / tertiaire (« Refactoring UI » : la sémantique passe après la hiérarchie).
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Niveau d’importance d’un bouton. */
export type ButtonVariant = 'primary' | 'secondary' | 'raised' | 'tertiary' | 'danger' | 'danger-quiet';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink shadow-e1 hover:bg-accent-hover',
  secondary: 'bg-block text-ink hover:bg-hover',
  /** Sur fond coloré (encadrés) : bouton blanc légèrement surélevé. */
  raised: 'bg-raised text-ink shadow-e1 hover:bg-hover',
  tertiary: 'text-ink-2 hover:bg-hover hover:text-ink',
  danger: 'bg-red-600 text-white shadow-e1 hover:bg-red-700',
  'danger-quiet': 'text-red-600 hover:bg-tint-red',
};

const BUTTON_SIZES = {
  sm: 'h-8 gap-2 px-2 text-sm',
  md: 'h-8 gap-2 px-3 text-sm',
  lg: 'h-12 gap-2 px-4 text-base',
} as const;

/** Bouton texte. `loading` remplace l'icône par un indicateur et désactive le bouton. */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: keyof typeof BUTTON_SIZES; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded font-semibold whitespace-nowrap transition-colors select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/** Bouton icône seule ; `label` sert d'infobulle et de nom accessible. `active` le met en couleur d'accent. */
export function IconButton({ label, children, className, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      {...rest}
      className={clsx(
        'inline-grid size-8 shrink-0 place-items-center rounded transition-colors hover:bg-hover',
        active ? 'text-accent' : 'text-ink-4 hover:text-ink-2',
        'focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Lien d'action tertiaire, discret (ex. « Reformuler l'énoncé », « Passer la question »). */
export function TextAction({ icon, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={clsx(
        'inline-flex items-center gap-2 rounded px-2 py-1 text-sm text-ink-3 transition-colors hover:bg-hover hover:text-ink',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
