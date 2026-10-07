// Carte mentale des notions (React Flow) : cours → chapitres → notions → sous-notions, placées par mindmap.ts.
// Ce composant gère l'état de la vue (chapitres repliés, cadrage) ; les nœuds et liens viennent de mapGraph.ts.
import type { NotionDto } from '@tpassist/shared';
import { Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { buildGraph, mindTreeOf } from './mapGraph';
import { MapActions, nodeTypes, type RootData } from './mapNodes';
import { layoutMindMap } from './mindmap';
import type { ChapterTree } from './tree';

/** Au-delà, les chapitres (sauf le premier) sont repliés à l'ouverture. */
const COLLAPSE_ABOVE = 80;
/** Largeur du panneau de détail (max-w-xl) : la notion choisie reste visible à sa gauche. */
const DRAWER_WIDTH = 576;
const FIT = { padding: 0.1, maxZoom: 1 };

interface NotionMapProps {
  course: RootData;
  chapters: ChapterTree[];
  notions: NotionDto[];
  byId: ReadonlyMap<string, NotionDto>;
  /** Notions qui utilisent chaque notion (dependantsOf). */
  dependants: ReadonlyMap<string, string[]>;
  selectedId: string | null;
  matches: ReadonlySet<string>;
  onSelect: (id: string) => void;
  /** Demande de centrer la carte sur une notion (le compteur change à chaque demande). */
  focus: { id: string; nonce: number } | null;
  /** Plein écran : la carte est recadrée quand sa taille change. */
  expanded: boolean;
}

/** Carte des notions (chaque carte a son propre état de zoom et de repli). */
export function NotionMap(props: NotionMapProps) {
  return (
    <ReactFlowProvider>
      <MapCanvas {...props} />
    </ReactFlowProvider>
  );
}

/**
 * Recadre toute la carte quand `expanded` change. La taille change parfois en deux temps (plein écran du navigateur) :
 * on recadre donc aussi à chaque redimensionnement pendant un court instant.
 */
function useRefitOnResize(wrapper: RefObject<HTMLDivElement | null>, expanded: boolean) {
  const { fitView } = useReactFlow();
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
  }, [wrapper, fitView]);
}

function MapCanvas({ course, chapters, notions, byId, dependants, selectedId, matches, onSelect, focus, expanded }: NotionMapProps) {
  const { getViewport, setViewport } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  useRefitOnResize(wrapper, expanded);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => (notions.length > COLLAPSE_ABOVE ? new Set(chapters.slice(1).map((c) => c.id)) : new Set()));
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
    const sel = selectedId ? byId.get(selectedId) : undefined;
    if (!sel) return;
    expand([sel.unitId, ...sel.prerequisiteIds.map(chapterOf), ...(dependants.get(sel.id) ?? []).map(chapterOf)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const placed = useMemo(() => new Map(layoutMindMap(mindTreeOf(chapters), collapsed).map((p) => [p.id, p])), [chapters, collapsed]);

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

  const { nodes, edges } = useMemo(
    () => buildGraph({ course, chapters, placed, collapsed, byId, dependants, selectedId, matches }),
    [course, chapters, placed, collapsed, byId, dependants, selectedId, matches],
  );

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
    <MapActions.Provider value={actions}>
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
    </MapActions.Provider>
  );
}
