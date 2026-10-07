// Barre d'outils de l'onglet Notions : recherche, choix carte ou liste, plein écran et régénération de la carte.
import type { NotionDto } from '@tpassist/shared';
import clsx from 'clsx';
import { List, Maximize2, Minimize2, Network, RefreshCw, Search } from 'lucide-react';
import { Button, IconButton, inputClass, Segmented } from '../../../components/ui';
import { plural } from '../../../lib/format';

/** Affichage des notions : carte mentale ou liste par chapitre. */
export type NotionsView = 'carte' | 'liste';

interface Props {
  /** Nom du cours, rappelé en plein écran (la page n'est plus visible). */
  courseName: string;
  query: string;
  onQuery: (query: string) => void;
  /** Notions trouvées par la recherche ; Entrée ouvre la première. */
  found: NotionDto[];
  onOpen: (id: string) => void;
  view: NotionsView;
  onView: (view: NotionsView) => void;
  fullscreen: boolean;
  onFullscreen: (on: boolean) => void;
  onRegenerate: () => void;
  canRegenerate: boolean;
}

export function NotionsToolbar({ courseName, query, onQuery, found, onOpen, view, onView, fullscreen, onFullscreen, onRegenerate, canRegenerate }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {fullscreen && <p className="mr-2 max-w-xs truncate text-sm font-semibold">Notions · {courseName}</p>}
      <label className="relative min-w-48 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && found[0]) onOpen(found[0].id);
          }}
          placeholder="Rechercher une notion"
          aria-label="Rechercher une notion"
          className={clsx(inputClass, 'pl-8')}
        />
      </label>
      {query && <span className="text-xs text-ink-3">{found.length === 0 ? 'Aucune notion' : `${plural(found.length, 'notion')} · Entrée pour ouvrir la première`}</span>}
      <div className="ml-auto flex items-center gap-2">
        {fullscreen ? (
          <Button icon={<Minimize2 className="size-4" />} onClick={() => onFullscreen(false)} title="Échap">
            Quitter le plein écran
          </Button>
        ) : (
          <>
            <Segmented
              value={view}
              onChange={onView}
              items={[
                { value: 'carte', label: <><Network className="size-4" /> Carte</> },
                { value: 'liste', label: <><List className="size-4" /> Liste</> },
              ]}
            />
            {view === 'carte' && (
              <IconButton label="Plein écran" onClick={() => onFullscreen(true)}>
                <Maximize2 className="size-4" />
              </IconButton>
            )}
            <IconButton label="Régénérer la carte" onClick={onRegenerate} disabled={!canRegenerate}>
              <RefreshCw className="size-4" />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}
