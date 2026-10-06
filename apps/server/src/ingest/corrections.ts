import type { CorrigeSolution } from '@tpassist/shared';
import type { LinkCorrections } from '../ai/schemas';
import { normalizeLabel, range } from './segment';

export interface MatchedSolution {
  solutionMd: string;
  pages: number[];
}

/** Regroupe les solutions associées à chaque question (plusieurs morceaux possibles). */
export function groupMatchedSolutions(
  solutions: CorrigeSolution[],
  matches: { solutionIndex: number; questionId: string }[],
): Map<string, MatchedSolution> {
  const out = new Map<string, MatchedSolution>();
  for (const m of [...matches].sort((a, b) => a.solutionIndex - b.solutionIndex)) {
    const s = solutions[m.solutionIndex];
    if (!s) continue;
    const pages = s.pageStart != null ? range(s.pageStart, s.pageEnd ?? s.pageStart) : [];
    const cur = out.get(m.questionId);
    if (cur) {
      cur.solutionMd = `${cur.solutionMd}\n\n${s.solutionMd}`;
      cur.pages = [...new Set([...cur.pages, ...pages])];
    } else {
      out.set(m.questionId, { solutionMd: s.solutionMd, pages });
    }
  }
  return out;
}

export interface LinkTarget {
  id: string;
  title: string;
  questions: { id: string; exerciseTitle: string; label: string }[];
}

export interface LinkCorrige {
  id: string;
  title: string;
  targetTitle: string;
  solutions: CorrigeSolution[];
}

function tokens(s: string) {
  return new Set(
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t && !['corrige', 'correction', 'du', 'de', 'la', 'le', 'des'].includes(t)),
  );
}

function similarity(a: string, b: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

function exerciseNumber(title: string) {
  return /(\d+)/.exec(title)?.[1] ?? '';
}

/** Rattachement heuristique (mode simulation et repli). */
export function heuristicLinkCorrections(corriges: LinkCorrige[], targets: LinkTarget[]): LinkCorrections {
  return {
    links: corriges.map((c) => {
      let best: LinkTarget | null = null;
      let bestScore = 0;
      for (const t of targets) {
        const s = Math.max(similarity(c.targetTitle, t.title), similarity(c.title, t.title));
        if (s > bestScore) {
          best = t;
          bestScore = s;
        }
      }
      if (!best || bestScore < 0.3) return { corrigeUnitId: c.id, targetUnitId: null, matches: [] };
      const matches: { solutionIndex: number; questionId: string }[] = [];
      c.solutions.forEach((s, i) => {
        const q = best!.questions.find(
          (q) => exerciseNumber(q.exerciseTitle) === exerciseNumber(s.exerciseLabel) && normalizeLabel(q.label) === normalizeLabel(s.questionLabel),
        );
        if (q) matches.push({ solutionIndex: i, questionId: q.id });
      });
      return { corrigeUnitId: c.id, targetUnitId: best.id, matches };
    }),
  };
}
