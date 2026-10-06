// Placement de la carte mentale des notions : arbre de gauche à droite.
// Chaque feuille occupe sa ligne ; chaque parent est centré verticalement sur ses enfants.
// Les dimensions correspondent aux classes des nœuds (w-64 = 256 px, h-12 = 48 px…).

export type MindDepth = 0 | 1 | 2 | 3;

export interface MindTree {
  id: string;
  depth: MindDepth;
  children: MindTree[];
}

export interface Placed {
  id: string;
  depth: MindDepth;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Largeur et hauteur des nœuds par profondeur : cours, chapitre, notion, sous-notion. */
export const NODE_SIZE: Record<MindDepth, { width: number; height: number }> = {
  0: { width: 256, height: 64 },
  1: { width: 256, height: 48 },
  2: { width: 256, height: 48 },
  3: { width: 192, height: 32 },
};
/** Écart vertical entre frères, selon leur profondeur. */
const GAP_Y: Record<MindDepth, number> = { 0: 0, 1: 32, 2: 12, 3: 4 };
const GAP_X = 64;

function columnX(depth: MindDepth): number {
  let x = 0;
  for (let d = 0; d < depth; d++) x += NODE_SIZE[d as MindDepth].width + GAP_X;
  return x;
}

/** Place l'arbre ; les enfants des nœuds repliés (`collapsed`) sont ignorés. */
export function layoutMindMap(root: MindTree, collapsed: ReadonlySet<string> = new Set()): Placed[] {
  const heights = new Map<string, number>();
  const visibleChildren = (n: MindTree) => (collapsed.has(n.id) ? [] : n.children);

  const measure = (n: MindTree): number => {
    const own = NODE_SIZE[n.depth].height;
    const kids = visibleChildren(n);
    const block = kids.reduce((sum, c) => sum + measure(c), 0) + Math.max(0, kids.length - 1) * (kids[0] ? GAP_Y[kids[0].depth] : 0);
    const h = Math.max(own, block);
    heights.set(n.id, h);
    return h;
  };

  const out: Placed[] = [];
  const place = (n: MindTree, top: number) => {
    const h = heights.get(n.id)!;
    const { width, height } = NODE_SIZE[n.depth];
    out.push({ id: n.id, depth: n.depth, x: columnX(n.depth), y: top + (h - height) / 2, width, height });
    const kids = visibleChildren(n);
    if (kids.length === 0) return;
    const gap = GAP_Y[kids[0].depth];
    const block = kids.reduce((sum, c) => sum + heights.get(c.id)!, 0) + (kids.length - 1) * gap;
    let y = top + (h - block) / 2;
    for (const c of kids) {
      place(c, y);
      y += heights.get(c.id)! + gap;
    }
  };

  measure(root);
  place(root, 0);
  return out;
}
