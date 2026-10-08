// Grille des pages d'un document : miniatures, parties qui couvrent chaque page, sélection d'une plage de pages
// et agrandissement d'une page.
import type { UnitDto, UnitKind } from '@tpassist/shared';
import clsx from 'clsx';
import { Check, Maximize2 } from 'lucide-react';
import { useState } from 'react';
import { PageImageModal, type PageImage } from '../../components/PageImageModal';
import { IconButton, Tag, type Tone } from '../../components/ui';
import { KIND_ICON } from '../course/common';

/** Plage de pages sélectionnée (incluse). */
export interface PageRange {
  start: number;
  end: number;
}

/**
 * Sélection après un clic sur `page` : le premier clic choisit une page, le suivant étend jusqu'à la page cliquée ;
 * ensuite, chaque clic déplace le bord le plus proche (le début ou la fin). Recliquer la seule page choisie annule.
 */
export function nextSelection(cur: PageRange | null, page: number): PageRange | null {
  if (!cur) return { start: page, end: page };
  if (cur.start === cur.end) return page === cur.start ? null : { start: Math.min(cur.start, page), end: Math.max(cur.start, page) };
  if (page < cur.start) return { ...cur, start: page };
  if (page > cur.end) return { ...cur, end: page };
  return page - cur.start < cur.end - page ? { ...cur, start: page } : { ...cur, end: page };
}

/** Teinte de l'étiquette de chaque type de partie. */
const KIND_TONE: Record<UnitKind, Tone> = { cours: 'blue', td: 'green', tp: 'green', ei: 'yellow', corrige: 'grey' };

/** URL du rendu d'une page ; `thumb` : miniature. */
function pageUrl(documentId: string, page: number, thumb?: boolean) {
  return `/api/documents/${documentId}/pages/${page}${thumb ? '?size=thumb' : ''}`;
}

/**
 * @param units parties extraites de ce document (pour étiqueter chaque page)
 * @param onPick clic sur une page ; absent, la grille est en lecture seule
 */
export function PageGrid({
  documentId,
  pageCount,
  units,
  selection,
  onPick,
}: {
  documentId: string;
  pageCount: number;
  units: UnitDto[];
  selection: PageRange | null;
  onPick?: (page: number) => void;
}) {
  const [zoom, setZoom] = useState<PageImage | null>(null);
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);
  return (
    <>
      <ol className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
        {pages.map((p) => {
          const selected = Boolean(selection && p >= selection.start && p <= selection.end);
          const covering = units.filter((u) => u.pageStart !== null && u.pageEnd !== null && p >= u.pageStart && p <= u.pageEnd);
          return (
            <li key={p} className="min-w-0">
              <div className="relative">
                <button
                  type="button"
                  aria-label={`Page ${p}`}
                  aria-pressed={onPick ? selected : undefined}
                  disabled={!onPick}
                  onClick={() => onPick?.(p)}
                  className={clsx(
                    'block w-full overflow-hidden rounded bg-white transition-shadow',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    selected ? 'shadow-e2 ring-2 ring-accent' : 'shadow-e1 enabled:hover:shadow-e3',
                  )}
                >
                  <img src={pageUrl(documentId, p, true)} alt="" loading="lazy" className="block aspect-[210/297] w-full object-contain" />
                </button>
                {selected && (
                  <span className="pointer-events-none absolute top-2 left-2 grid size-6 place-items-center rounded-full bg-accent text-accent-ink shadow-e1">
                    <Check className="size-4" />
                  </span>
                )}
                <IconButton
                  label={`Agrandir la page ${p}`}
                  className="absolute top-2 right-2 bg-raised shadow-e1"
                  onClick={() => setZoom({ url: pageUrl(documentId, p), label: `Page ${p}` })}
                >
                  <Maximize2 className="size-4" />
                </IconButton>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className={clsx('mr-1 text-xs tabular-nums', selected ? 'font-semibold text-ink' : 'text-ink-3')}>p. {p}</span>
                {covering.map((u) => (
                  <Tag key={u.id} tone={KIND_TONE[u.kind]} className="max-w-full">
                    {KIND_ICON[u.kind]}
                    <span className="min-w-0 truncate">{u.title}</span>
                  </Tag>
                ))}
                {covering.length === 0 && <span className="text-xs text-ink-4">Non attribuée</span>}
              </div>
            </li>
          );
        })}
      </ol>
      <PageImageModal page={zoom} onClose={() => setZoom(null)} />
    </>
  );
}
