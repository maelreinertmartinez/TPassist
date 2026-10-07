// Vue « Liste » de l'onglet Notions : les notions par chapitre, sous-notions en retrait, filtrées par la recherche.
import { NOTION_KIND_LABELS, type NotionDto } from '@tpassist/shared';
import clsx from 'clsx';
import type { ChapterTree, NotionNode } from './tree';

interface Props {
  chapters: ChapterTree[];
  query: string;
  /** Notions trouvées par la recherche (une notion principale reste visible si une de ses sous-notions correspond). */
  matches: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Ligne cliquable d'une notion ou sous-notion. */
function NotionRow({ notion: n, sub, selected, onSelect }: { notion: NotionDto; sub: boolean; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(n.id)}
      className={clsx('flex w-full items-start gap-3 rounded px-2 py-1 text-left transition-colors hover:bg-hover', selected && 'bg-hover')}
    >
      <span className="min-w-0 flex-1">
        <span className={clsx('block', sub ? 'text-sm' : 'text-sm font-semibold')}>{n.title}</span>
        {n.summary && <span className="block truncate text-xs text-ink-3">{n.summary}</span>}
      </span>
      <span className="flex h-6 shrink-0 items-center gap-2 text-xs text-ink-3">
        {n.weakPointIds.length > 0 && <span className="size-2 rounded-full bg-red-500" title="Point bloquant" />}
        {NOTION_KIND_LABELS[n.kind]}
      </span>
    </button>
  );
}

export function NotionOutline({ chapters, query, matches, selectedId, onSelect }: Props) {
  const searching = query.trim() !== '';
  const keep = (n: NotionNode) => !searching || matches.has(n.id) || n.children.some((c) => matches.has(c.id));
  const visible = chapters.map((c) => ({ ...c, notions: c.notions.filter(keep) })).filter((c) => c.notions.length > 0);
  if (visible.length === 0) return <p className="px-2 text-sm text-ink-3">Aucune notion ne correspond à ta recherche.</p>;
  return (
    <div className="space-y-8">
      {visible.map((c) => (
        <section key={c.id}>
          <h3 className="mb-2 px-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">{c.title}</h3>
          <ul className="space-y-1">
            {c.notions.map((n) => (
              <li key={n.id}>
                <NotionRow notion={n} sub={false} selected={n.id === selectedId} onSelect={onSelect} />
                {n.children.length > 0 && (
                  <ul className="mt-1 ml-6 space-y-1 border-l border-line pl-2">
                    {n.children
                      .filter((s) => !searching || matches.has(s.id) || matches.has(n.id))
                      .map((s) => (
                        <li key={s.id}>
                          <NotionRow notion={s} sub selected={s.id === selectedId} onSelect={onSelect} />
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
