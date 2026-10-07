// Construction de la carte des notions, en fonctions pures : l'arbre à placer (cours → chapitres → notions →
// sous-notions), puis les nœuds et liens React Flow selon la sélection, la recherche et les chapitres repliés.
import type { NotionDto } from '@tpassist/shared';
import { MarkerType, type Edge } from '@xyflow/react';
import type { MapNode, RootData } from './mapNodes';
import type { MindTree, Placed } from './mindmap';
import type { ChapterTree } from './tree';

/** Sans sélection ni glisser natifs, React Flow rend les nœuds transparents au clic : nos boutons doivent les recevoir. */
const CLICKABLE = { pointerEvents: 'all' } as const;

/** Arbre à placer : le cours, ses chapitres, leurs notions et sous-notions. */
export function mindTreeOf(chapters: ChapterTree[]): MindTree {
  return {
    id: 'root',
    depth: 0,
    children: chapters.map((c) => ({
      id: c.id,
      depth: 1,
      children: c.notions.map((n) => ({ id: n.id, depth: 2, children: n.children.map((s) => ({ id: s.id, depth: 3, children: [] })) })),
    })),
  };
}

/** Ce que la carte doit montrer. */
export interface GraphInput {
  course: RootData;
  chapters: ChapterTree[];
  /** Place de chaque nœud visible (layoutMindMap). */
  placed: ReadonlyMap<string, Placed>;
  collapsed: ReadonlySet<string>;
  byId: ReadonlyMap<string, NotionDto>;
  dependants: ReadonlyMap<string, string[]>;
  selectedId: string | null;
  matches: ReadonlySet<string>;
}

/** Lien de l'arbre, du parent vers l'enfant. */
const treeEdge = (source: string, target: string): Edge => ({
  id: `t-${target}`,
  source,
  target,
  sourceHandle: 'out',
  targetHandle: 'in',
  style: { stroke: 'var(--color-line-strong)', strokeWidth: 1.5 },
});

/** Lien de prérequis en pointillés, du prérequis vers la notion qui l'utilise. */
const linkEdge = (source: string, target: string, color: string): Edge => ({
  id: `l-${source}-${target}`,
  source,
  target,
  sourceHandle: 'link-out',
  targetHandle: 'link-in',
  zIndex: 1,
  style: { stroke: color, strokeWidth: 2, strokeDasharray: '6 4' },
  markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
});

/**
 * Nœuds et liens React Flow. Avec une sélection, tout ce qui ne lui est pas lié est estompé et ses liens de prérequis
 * sont tracés ; sans sélection, une recherche estompe les notions qui ne correspondent pas.
 */
export function buildGraph({ course, chapters, placed, collapsed, byId, dependants, selectedId, matches }: GraphInput): { nodes: MapNode[]; edges: Edge[] } {
  const sel = selectedId ? byId.get(selectedId) : undefined;
  const prereqs = new Set(sel?.prerequisiteIds ?? []);
  const deps = new Set(selectedId ? (dependants.get(selectedId) ?? []) : []);

  // Liées à la sélection : elle-même, ses prérequis, ses dépendantes, leurs chapitres et notions parentes, ses sous-notions.
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
  const pos = (id: string) => {
    const p = placed.get(id)!;
    return { x: p.x, y: p.y };
  };
  const notionNode = (n: NotionDto, sub: boolean): MapNode => ({
    id: n.id,
    type: 'notion',
    position: pos(n.id),
    style: CLICKABLE,
    data: { notion: n, sub, selected: n.id === selectedId, match: matches.has(n.id), dim: dimNotion(n.id) },
  });

  const nodes: MapNode[] = [{ id: 'root', type: 'root', position: pos('root'), data: course }];
  const edges: Edge[] = [];
  for (const c of chapters) {
    const isCollapsed = collapsed.has(c.id);
    const count = c.notions.reduce((s, n) => s + 1 + n.children.length, 0);
    nodes.push({ id: c.id, type: 'chapter', position: pos(c.id), style: CLICKABLE, data: { title: c.title, count, collapsed: isCollapsed, dim: Boolean(sel) && !related.has(c.id) } });
    edges.push(treeEdge('root', c.id));
    if (isCollapsed) continue;
    for (const n of c.notions) {
      nodes.push(notionNode(n, false));
      edges.push(treeEdge(c.id, n.id));
      for (const s of n.children) {
        nodes.push(notionNode(s, true));
        edges.push(treeEdge(n.id, s.id));
      }
    }
  }

  if (sel) {
    const visible = new Set(nodes.map((n) => n.id));
    for (const p of prereqs) if (visible.has(p)) edges.push(linkEdge(p, sel.id, 'var(--color-accent)'));
    for (const d of deps) if (visible.has(d)) edges.push(linkEdge(sel.id, d, 'var(--color-ink-4)'));
  }
  return { nodes, edges };
}
