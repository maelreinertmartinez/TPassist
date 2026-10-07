// Éléments superposés : fenêtre modale, confirmation, menu déroulant et tiroir latéral.
import clsx from 'clsx';
import { ChevronDown, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from './buttons';
import { useEscape } from './hooks';

/** Fenêtre modale (élément <dialog> natif) : se ferme avec Échap, la croix ou un clic sur le fond. */
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
      className={clsx('m-auto w-full rounded-lg bg-raised p-0 text-ink shadow-e5 backdrop:bg-black/40', wide ? 'max-w-3xl' : 'max-w-lg')}
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
  /** Action destructive : le bouton de confirmation est rouge. */
  danger?: boolean;
}

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

/** Fournit `useConfirm` à l'application : une seule fenêtre de confirmation, partagée. */
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

/** Demande une confirmation ; la promesse renvoie vrai si l'utilisateur confirme. */
export function useConfirm() {
  return useContext(ConfirmContext);
}

/** Menu déroulant attaché à un bouton ; se ferme au clic à l'extérieur ou avec Échap. */
export function Menu({ label, icon, items }: { label: string; icon?: ReactNode; items: { label: ReactNode; icon?: ReactNode; onSelect: () => void; disabled?: boolean; hint?: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
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

/**
 * Tiroir latéral droit (chat, fiche d'une notion), plein écran sur mobile ; se ferme avec Échap.
 * Fermé, il reste monté (pour garder son état) mais devient inerte.
 */
export function Drawer({ open, onClose, label, wide, children }: { open: boolean; onClose: () => void; label: string; wide?: boolean; children: ReactNode }) {
  useEscape(onClose, open);
  return (
    <aside
      className={clsx(
        'no-print fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-raised shadow-e4 transition-transform duration-200',
        wide ? 'max-w-xl' : 'max-w-md',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
      aria-hidden={!open}
      aria-label={label}
      inert={!open}
    >
      {children}
    </aside>
  );
}
