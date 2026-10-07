// Mise en page : conteneur de page, titres de section, blocs dépliables, onglets et choix segmentés.
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

const PAGE_WIDTHS = {
  narrow: 'max-w-xl',
  reading: 'max-w-2xl',
  document: 'max-w-3xl',
  wide: 'max-w-5xl',
} as const;

/**
 * Conteneur centré d'une page.
 * @param width largeur maximale selon le contenu (texte à lire, document, tableau de bord…)
 * @param spacious marges verticales plus grandes, pour un message seul (chargement, erreur)
 */
export function Page({ width = 'wide', spacious, children }: { width?: keyof typeof PAGE_WIDTHS; spacious?: boolean; children: ReactNode }) {
  return <div className={clsx('mx-auto px-4 sm:px-6', PAGE_WIDTHS[width], spacious ? 'py-24' : 'pt-12 pb-24')}>{children}</div>;
}

/** Petit titre de section en capitales, avec des actions éventuelles à droite. */
export function SectionLabel({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2">
      <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{children}</h2>
      {actions}
    </div>
  );
}

/** Bloc dépliable (toggle Notion). */
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

/** Onglets de vue soulignés, comme les vues Notion ; les onglets `hidden` ne sont pas affichés. */
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
