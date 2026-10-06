import type { NotionDto, UnitDto } from '@tpassist/shared';

export type NotionNode = NotionDto & { children: NotionDto[] };

export interface ChapterTree {
  id: string;
  title: string;
  notions: NotionNode[];
}

/** Regroupe les notions par chapitre (ordre du cours), les sous-notions sous leur notion principale. */
export function buildChapters(units: UnitDto[], notions: NotionDto[]): ChapterTree[] {
  const byOrder = (a: NotionDto, b: NotionDto) => a.order - b.order;
  return units
    .filter((u) => u.kind === 'cours')
    .sort((a, b) => a.order - b.order)
    .map((u) => {
      const mine = notions.filter((n) => n.unitId === u.id);
      return {
        id: u.id,
        title: u.title,
        notions: mine
          .filter((n) => !n.parentId)
          .sort(byOrder)
          .map((n) => ({ ...n, children: mine.filter((c) => c.parentId === n.id).sort(byOrder) })),
      };
    })
    .filter((c) => c.notions.length > 0);
}

/** Notions qui ont `id` pour prérequis. */
export function dependantsOf(notions: NotionDto[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const n of notions) for (const p of n.prerequisiteIds) out.set(p, [...(out.get(p) ?? []), n.id]);
  return out;
}

/** Minuscules sans accents, pour la recherche. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function searchNotions(notions: NotionDto[], query: string): NotionDto[] {
  const q = fold(query);
  if (!q) return [];
  return notions.filter((n) => fold(n.title).includes(q));
}
