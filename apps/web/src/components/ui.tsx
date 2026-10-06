import clsx from 'clsx';
import { ChevronDown, ChevronRight, Loader2, Lock, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

// ---------- Boutons : hiérarchie primaire / secondaire / tertiaire (« Semantics are secondary ») ----------

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

// ---------- Encadrés (callouts Notion) ----------

export type Tone = 'grey' | 'blue' | 'green' | 'red' | 'yellow';

export const TONE_CLASSES: Record<Tone, { box: string; icon: string }> = {
  grey: { box: 'bg-tint-grey text-tint-grey-ink', icon: 'text-tint-grey-icon' },
  blue: { box: 'bg-tint-blue text-tint-blue-ink', icon: 'text-tint-blue-icon' },
  green: { box: 'bg-tint-green text-tint-green-ink', icon: 'text-tint-green-icon' },
  red: { box: 'bg-tint-red text-tint-red-ink', icon: 'text-tint-red-icon' },
  yellow: { box: 'bg-tint-yellow text-tint-yellow-ink', icon: 'text-tint-yellow-icon' },
};

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

// ---------- Étiquettes ----------

export function Tag({ tone = 'grey', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded px-2 text-xs leading-6 whitespace-nowrap', TONE_CLASSES[tone].box, className)}>
      {children}
    </span>
  );
}

// ---------- Bloc dépliable (toggle Notion) ----------

export function Toggle({ summary, children, className, defaultOpen }: { summary: ReactNode; children: ReactNode; className?: string; defaultOpen?: boolean }) {
  return (
    <details className={clsx('group', className)} open={defaultOpen}>
      <summary className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-hover">
        <ChevronRight className="size-4 shrink-0 text-ink-4 transition-transform group-open:rotate-90" />
        <span className="min-w-0 flex-1">{summary}</span>
      </summary>
      <div className="pt-2 pl-8">{children}</div>
    </details>
  );
}

// ---------- Onglets de vue (soulignés, comme les vues Notion) ----------

export function ViewTabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; hidden?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 border-b border-line" role="tablist">
      {items
        .filter((it) => !it.hidden)
        .map((it) => (
          <button
            type="button"
            key={it.value}
            role="tab"
            aria-selected={value === it.value}
            onClick={() => onChange(it.value)}
            className={clsx(
              '-mb-px inline-flex items-center gap-2 border-b-2 py-2 text-sm transition-colors',
              value === it.value ? 'border-accent font-semibold text-ink' : 'border-transparent text-ink-3 hover:text-ink',
            )}
          >
            {it.label}
          </button>
        ))}
    </div>
  );
}

/** Choix segmenté compact (type de réponse, taille de quiz…). */
export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded bg-block p-1" role="tablist">
      {items.map((it) => (
        <button
          type="button"
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            'inline-flex h-6 items-center gap-2 rounded px-2 text-sm transition-colors',
            value === it.value ? 'bg-raised font-semibold text-ink shadow-e1' : 'text-ink-3 hover:text-ink',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Retours d'état ----------

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2 text-sm text-ink-3', className)}>
      <Loader2 className="size-4 animate-spin" />
      {label}
    </span>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <Callout tone="red" aside={onRetry && <Button size="sm" variant="tertiary" onClick={onRetry}>Réessayer</Button>}>
      <p className="text-sm">{msg}</p>
    </Callout>
  );
}

export function ProgressBar({ value, className, onTint }: { value: number; className?: string; onTint?: boolean }) {
  return (
    <div className={clsx('h-1 w-full overflow-hidden rounded-full', onTint ? 'bg-page' : 'bg-hover', className)}>
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

/** Anneau de progression pour un compte à rebours (accompagné du temps en texte). */
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

export function LockedHint({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-3">
      <Lock className="size-4 text-ink-4" />
      {children}
    </span>
  );
}

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

export function SectionLabel({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2">
      <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{children}</h2>
      {actions}
    </div>
  );
}

// ---------- Formulaires ----------

export const inputClass =
  'w-full rounded border border-line-strong bg-page px-3 py-2 text-sm text-ink placeholder:text-ink-4 transition-colors focus:border-accent focus:outline-none focus:ring-4 focus:ring-blue-500/20';

/** Champ « en place » à la Notion : sans bordure tant qu'on ne le survole ou ne le sélectionne pas. */
export const inlineInputClass =
  'w-full rounded border border-transparent bg-transparent px-2 py-1 text-ink placeholder:text-ink-4 transition-colors hover:bg-hover focus:border-accent focus:bg-page focus:outline-none';

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={clsx(inputClass, className)} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={clsx(inputClass, 'leading-6', className)} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

// ---------- Fenêtres ----------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={clsx(
        'm-auto w-full rounded-lg bg-raised p-0 text-ink shadow-e5 backdrop:bg-black/40',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-screen flex-col">
          <div className="flex items-center justify-between gap-4 px-6 pt-6">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <IconButton label="Fermer" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="overflow-y-auto px-6 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 px-6 pb-6">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

/** Confirmation stylée : l'action destructive devient l'action primaire (rouge) de la fenêtre. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(state)}
        onClose={() => close(false)}
        title={state?.title ?? ''}
        footer={
          <>
            <Button variant="tertiary" onClick={() => close(false)}>
              Annuler
            </Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {state?.confirmLabel}
            </Button>
          </>
        }
      >
        <div className="text-sm text-ink-2">{state?.message}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}

// ---------- Menu déroulant ----------

export function Menu({ label, icon, items }: { label: string; icon?: ReactNode; items: { label: ReactNode; icon?: ReactNode; onSelect: () => void; disabled?: boolean; hint?: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Button icon={icon} onClick={() => setOpen(!open)} aria-expanded={open}>
        {label}
        <ChevronDown className="size-4 text-ink-4" />
      </Button>
      {open && (
        <div className="absolute left-0 z-30 mt-2 w-64 rounded-lg bg-raised p-1 shadow-e2" role="menu">
          {items.map((it, i) => (
            <button
              type="button"
              key={i}
              role="menuitem"
              disabled={it.disabled}
              title={it.hint}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-ink-4">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
