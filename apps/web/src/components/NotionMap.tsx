import { NOTION_KIND_LABELS, type NotionDto } from '@tpassist/shared';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import clsx from 'clsx';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CourseIconTile } from '../lib/courseIcons';
import { layoutMindMap, type MindTree } from '../lib/mindmap';
import { dependantsOf, type ChapterTree } from '../lib/notions';

/** Au-delà, les chapitres (sauf le premier) sont repliés à l'ouverture. */
const COLLAPSE_ABOVE = 80;
/** Largeur du panneau de détail (max-w-xl) : la notion choisie reste visible à sa gauche. */
const DRAWER_WIDTH = 576;
const FIT = { padding: 0.1, maxZoom: 1 };

type RootData = { name: string; icon: string; color: string };
type ChapterData = { title: string; count: number; collapsed: boolean; dim: boolean };
type NotionData = { notion: NotionDto; sub: boolean; selected: boolean; match: boolean; dim: boolean };

type MapNode = Node<RootData, 'root'> | Node<ChapterData, 'chapter'> | Node<NotionData, 'notion'>;

/** Sans sélection ni glisser natifs, React Flow rend les nœuds transparents au clic : nos boutons doivent les recevoir. */
const CLICKABLE = { pointerEvents: 'all' } as const;

const Actions = createContext<{ select: (id: string) => void; toggle: (id: string) => void }>({ select: () => {}, toggle: () => {} });

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

function ChapterNode({ id, data }: NodeProps<Node<ChapterData, 'chapter'>>) {
  const { toggle } = useContext(Actions);
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

function NotionNodeView({ data }: NodeProps<Node<NotionData, 'notion'>>) {
  const { select } = useContext(Actions);
  const n = data.notion;
  const weak = n.weakPointIds.length > 0;
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
      {weak && <span className="size-2 shrink-0 rounded-full bg-red-500" title="Point bloquant" />}
      <Handles />
    </button>
  );
}

const nodeTypes = { root: RootNode, chapter: ChapterNode, notion: NotionNodeView };

export interface NotionMapProps {
  course: RootData;
  chapters: ChapterTree[];
  notions: NotionDto[];
  selectedId: string | null;
  matches: ReadonlySet<string>;
  onSelect: (id: string) => void;
  /** Demande de centrer la carte sur une notion (le compteur change à chaque demande). */
  focus: { id: string; nonce: number } | null;
  /** Plein écran : la carte est recadrée quand sa taille change. */
  expanded: boolean;
}

export function NotionMap(props: NotionMapProps) {
  return (
    <ReactFlowProvider>
      <MapCanvas {...props} />
    </ReactFlowProvider>
  );
}

function MapCanvas({ course, chapters, notions, selectedId, matches, onSelect, focus, expanded }: NotionMapProps) {
  const { getViewport, setViewport, fitView } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  // Entrée/sortie du plein écran : la taille change (parfois en deux temps avec le plein écran du navigateur),
  // on recadre toute la carte pendant un court instant.
  const refitUntil = useRef(0);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    refitUntil.current = Date.now() + 800;
    requestAnimationFrame(() => void fitView(FIT));
  }, [expanded, fitView]);
  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (Date.now() < refitUntil.current) void fitView(FIT);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => (notions.length > COLLAPSE_ABOVE ? new Set(chapters.slice(1).map((c) => c.id)) : new Set()));
  const byId = useMemo(() => new Map(notions.map((n) => [n.id, n])), [notions]);
  const dependants = useMemo(() => dependantsOf(notions), [notions]);
  const chapterOf = (id: string) => byId.get(id)?.unitId;

  const expand = (ids: (string | undefined)[]) =>
    setCollapsed((cur) => {
      const toOpen = ids.filter((c): c is string => Boolean(c) && cur.has(c!));
      if (toOpen.length === 0) return cur;
      const next = new Set(cur);
      toOpen.forEach((c) => next.delete(c));
      return next;
    });

  // Les chapitres des notions liées à la sélection sont dépliés pour montrer les liens.
  useEffect(() => {
    if (!selectedId) return;
    const sel = byId.get(selectedId);
    if (!sel) return;
    expand([sel.unitId, ...sel.prerequisiteIds.map(chapterOf), ...(dependants.get(selectedId) ?? []).map(chapterOf)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const placed = useMemo(() => {
    const tree: MindTree = {
      id: 'root',
      depth: 0,
      children: chapters.map((c) => ({
        id: c.id,
        depth: 1,
        children: c.notions.map((n) => ({ id: n.id, depth: 2, children: n.children.map((s) => ({ id: s.id, depth: 3, children: [] })) })),
      })),
    };
    return new Map(layoutMindMap(tree, collapsed).map((p) => [p.id, p]));
  }, [chapters, collapsed]);

  /**
   * Amène une notion dans la partie visible de la carte (à gauche du panneau de détail quand il la recouvre).
   * `center` : toujours centrer (et zoomer un peu si besoin) ; `ifHidden` : seulement si elle est cachée.
   */
  const reveal = (id: string, mode: 'center' | 'ifHidden') => {
    const p = placed.get(id);
    const el = wrapper.current;
    if (!p || !el) return;
    const rect = el.getBoundingClientRect();
    const drawerLeft = window.innerWidth - DRAWER_WIDTH;
    // Sur un écran étroit, le panneau couvre tout : on ne tient pas compte de lui.
    const right = drawerLeft - rect.left > 320 ? Math.min(rect.right, drawerLeft) : rect.right;
    const { x, y, zoom: current } = getViewport();
    if (mode === 'ifHidden') {
      const left = rect.left + x + p.x * current;
      const top = rect.top + y + p.y * current;
      if (left >= rect.left && left + p.width * current <= right && top >= rect.top && top + p.height * current <= rect.bottom) return;
    }
    const zoom = mode === 'center' ? Math.max(current, 0.9) : current;
    const cx = (right - rect.left) / 2;
    const cy = rect.height / 2;
    void setViewport({ x: cx - (p.x + p.width / 2) * zoom, y: cy - (p.y + p.height / 2) * zoom, zoom }, { duration: 400 });
  };

  // Une notion choisie sur la carte ou dans le panneau reste visible (une fois sa place connue).
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId) {
      revealed.current = null;
      return;
    }
    if (revealed.current === selectedId || !placed.has(selectedId)) return;
    revealed.current = selectedId;
    // Laisse le panneau commencer à s'ouvrir avant de mesurer.
    requestAnimationFrame(() => reveal(selectedId, 'ifHidden'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, placed]);

  // Centrage demandé (recherche, puce « prérequis » du panneau) : on déplie d'abord le chapitre si besoin.
  const handled = useRef(0);
  useEffect(() => {
    if (!focus || handled.current === focus.nonce) return;
    const chapter = chapterOf(focus.id);
    if (chapter && collapsed.has(chapter)) return expand([chapter]);
    if (!placed.has(focus.id)) return;
    handled.current = focus.nonce;
    revealed.current = focus.id;
    reveal(focus.id, 'center');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, placed, collapsed]);

  const { nodes, edges } = useMemo(() => {
    const sel = selectedId ? byId.get(selectedId) : undefined;
    const prereqs = new Set(sel?.prerequisiteIds ?? []);
    const deps = new Set(selectedId ? (dependants.get(selectedId) ?? []) : []);
    const related = new Set<string>();
    if (sel) {
      [sel.id, ...prereqs, ...deps].forEach((id) => {
        related.add(id);
        const n = byId.get(id);
        if (n?.parentId) related.add(n.parentId);
        if (n) related.add(n.unitId);
      });
      chapters.flatMap((c) => c.notions).find((n) => n.id === sel.id)?.children.forEach((c) => related.add(c.id));
    }
    const searching = !sel && matches.size > 0;
    const dimNotion = (id: string) => (sel ? !related.has(id) : searching ? !matches.has(id) : false);

    const nodes: MapNode[] = [];
    const edges: Edge[] = [];
    const pos = (id: string) => {
      const p = placed.get(id)!;
      return { x: p.x, y: p.y };
    };
    const treeEdge = (source: string, target: string): Edge => ({
      id: `t-${target}`,
      source,
      target,
      sourceHandle: 'out',
      targetHandle: 'in',
      style: { stroke: 'var(--color-line-strong)', strokeWidth: 1.5 },
    });

    nodes.push({ id: 'root', type: 'root', position: pos('root'), data: course });
    for (const c of chapters) {
      const isCollapsed = collapsed.has(c.id);
      const count = c.notions.reduce((s, n) => s + 1 + n.children.length, 0);
      nodes.push({ id: c.id, type: 'chapter', position: pos(c.id), style: CLICKABLE, data: { title: c.title, count, collapsed: isCollapsed, dim: Boolean(sel) && !related.has(c.id) } });
      edges.push(treeEdge('root', c.id));
      if (isCollapsed) continue;
      for (const n of c.notions) {
        nodes.push({ id: n.id, type: 'notion', position: pos(n.id), style: CLICKABLE, data: { notion: n, sub: false, selected: n.id === selectedId, match: matches.has(n.id), dim: dimNotion(n.id) } });
        edges.push(treeEdge(c.id, n.id));
        for (const s of n.children) {
          nodes.push({ id: s.id, type: 'notion', position: pos(s.id), style: CLICKABLE, data: { notion: s, sub: true, selected: s.id === selectedId, match: matches.has(s.id), dim: dimNotion(s.id) } });
          edges.push(treeEdge(n.id, s.id));
        }
      }
    }

    // Liens de prérequis de la notion sélectionnée : flèche du prérequis vers la notion qui l'utilise.
    if (sel) {
      const visible = new Set(nodes.map((n) => n.id));
      const link = (source: string, target: string, color: string): Edge => ({
        id: `l-${source}-${target}`,
        source,
        target,
        sourceHandle: 'link-out',
        targetHandle: 'link-in',
        zIndex: 1,
        style: { stroke: color, strokeWidth: 2, strokeDasharray: '6 4' },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      });
      for (const p of prereqs) if (visible.has(p)) edges.push(link(p, sel.id, 'var(--color-accent)'));
      for (const d of deps) if (visible.has(d)) edges.push(link(sel.id, d, 'var(--color-ink-4)'));
    }
    return { nodes, edges };
  }, [placed, chapters, collapsed, course, byId, dependants, selectedId, matches]);

  const actions = useMemo(
    () => ({
      select: onSelect,
      toggle: (id: string) =>
        setCollapsed((cur) => {
          const next = new Set(cur);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
    }),
    [onSelect],
  );

  return (
    <Actions.Provider value={actions}>
      <ReactFlow
        ref={wrapper}
        className="notion-map"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={FIT}
        minZoom={0.15}
        maxZoom={1.75}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--color-line-strong)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </Actions.Provider>
  );
}
