// Rendu de la carte des notions : nœuds React Flow (cours, chapitre, notion) et légende affichée sous la carte.
import { NOTION_KIND_LABELS, type NotionDto } from '@tpassist/shared';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { createContext, useContext } from 'react';
import { CourseIconTile } from '../../../components/CourseAppearance';

/** Racine de la carte : le cours. */
export type RootData = { name: string; icon: string; color: string };
type ChapterData = { title: string; count: number; collapsed: boolean; dim: boolean };
type NotionData = { notion: NotionDto; sub: boolean; selected: boolean; match: boolean; dim: boolean };

/** Nœud de la carte, selon son type. */
export type MapNode = Node<RootData, 'root'> | Node<ChapterData, 'chapter'> | Node<NotionData, 'notion'>;

/** Actions déclenchées depuis un nœud (React Flow ne transmet aux nœuds que leurs données). */
export const MapActions = createContext<{ select: (id: string) => void; toggle: (id: string) => void }>({ select: () => {}, toggle: () => {} });

/** Poignées invisibles : à gauche/droite pour l'arbre, à droite pour les liens de prérequis (en arc). */
function Handles() {
  return (
    <>
      <Handle type="target" id="in" position={Position.Left} isConnectable={false} />
      <Handle type="source" id="out" position={Position.Right} isConnectable={false} />
      <Handle type="target" id="link-in" position={Position.Right} isConnectable={false} />
      <Handle type="source" id="link-out" position={Position.Right} isConnectable={false} />
    </>
  );
}

function RootNode({ data }: NodeProps<Node<RootData, 'root'>>) {
  return (
    <div className="flex h-16 w-64 items-center gap-3 rounded-lg bg-raised px-3 shadow-e2">
      <CourseIconTile icon={data.icon} color={data.color} size="sm" />
      <p className="line-clamp-2 text-sm leading-5 font-semibold">{data.name}</p>
      <Handles />
    </div>
  );
}

/** Chapitre : un clic le replie ou le déplie. */
function ChapterNode({ id, data }: NodeProps<Node<ChapterData, 'chapter'>>) {
  const { toggle } = useContext(MapActions);
  return (
    <button
      type="button"
      onClick={() => toggle(id)}
      aria-expanded={!data.collapsed}
      title={data.collapsed ? 'Déplier le chapitre' : 'Replier le chapitre'}
      className={clsx(
        'flex h-12 w-64 items-center gap-2 rounded-lg bg-block px-3 text-left transition-opacity hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent',
        data.dim && 'opacity-40',
      )}
    >
      {data.collapsed ? <ChevronRight className="size-4 shrink-0 text-ink-4" /> : <ChevronDown className="size-4 shrink-0 text-ink-4" />}
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{data.title}</span>
      <span className="shrink-0 text-xs text-ink-3 tabular-nums">{data.count}</span>
      <Handles />
    </button>
  );
}

/** Notion ou sous-notion : un clic ouvre sa fiche. */
function NotionNodeView({ data }: NodeProps<Node<NotionData, 'notion'>>) {
  const { select } = useContext(MapActions);
  const n = data.notion;
  return (
    <button
      type="button"
      onClick={() => select(n.id)}
      title={n.summary || n.title}
      className={clsx(
        'flex items-center gap-2 text-left transition focus-visible:outline-2 focus-visible:outline-accent',
        data.sub ? 'h-8 w-48 rounded bg-raised px-2 shadow-e1 hover:bg-hover' : 'h-12 w-64 rounded-lg bg-raised px-3 shadow-e1 hover:shadow-e2',
        data.selected && 'ring-2 ring-accent',
        data.match && !data.selected && 'ring-2 ring-yellow-400',
        data.dim && 'opacity-40',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate', data.sub ? 'text-xs' : 'text-sm')}>{n.title}</span>
        {!data.sub && <span className="block truncate text-xs text-ink-3">{NOTION_KIND_LABELS[n.kind]}</span>}
      </span>
      {n.weakPointIds.length > 0 && <span className="size-2 shrink-0 rounded-full bg-red-500" title="Point bloquant" />}
      <Handles />
    </button>
  );
}

/** Composant de chaque type de nœud, pour React Flow. */
export const nodeTypes = { root: RootNode, chapter: ChapterNode, notion: NotionNodeView };

/** Légende sous la carte : liens de la notion choisie (ou mode d'emploi) et pastille des points bloquants. */
export function MapLegend({ selected, hasWeak }: { selected: NotionDto | null; hasWeak: boolean }) {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
      {selected ? (
        <>
          <span className="inline-flex items-center gap-2">
            <span className="w-4 border-t-2 border-dashed border-accent" /> prérequis de « {selected.title} »
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-4 border-t-2 border-dashed border-ink-4" /> notions qui l’utilisent
          </span>
        </>
      ) : (
        <span>Clique sur une notion pour ouvrir sa fiche, sur un chapitre pour le replier.</span>
      )}
      {hasWeak && (
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-full bg-red-500" /> point bloquant
        </span>
      )}
    </p>
  );
}
