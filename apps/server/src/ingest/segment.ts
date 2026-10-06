import { UNIT_KIND_LABELS, type UnitKind } from '@tpassist/shared';

export type PageKind = UnitKind | 'autre';

export interface PageClass {
  page: number;
  kind: PageKind;
  unitTitle: string;
  startsNewUnit: boolean;
  startsMidPage: boolean;
}

export interface UnitSpan {
  kind: UnitKind;
  title: string;
  pageStart: number;
  pageEnd: number;
}

/**
 * Regroupe les pages classées en unités contiguës (cours, TD, TP, EI, corrigé).
 * Une page dont la nouvelle partie commence au milieu (`startsMidPage`) est partagée :
 * elle termine l'unité précédente et commence la suivante.
 */
export function mergePagesIntoUnits(pages: PageClass[]): UnitSpan[] {
  const sorted = [...pages].sort((a, b) => a.page - b.page);
  const spans: UnitSpan[] = [];
  const counters: Partial<Record<UnitKind, number>> = {};
  let cur: UnitSpan | null = null;

  for (const p of sorted) {
    if (p.kind === 'autre') {
      // Page de garde, blanche… rattachée à l'unité en cours si elle existe.
      if (cur) cur.pageEnd = p.page;
      continue;
    }
    const title = p.unitTitle?.trim();
    const isNew = !cur || p.startsNewUnit || p.kind !== cur.kind;
    if (!isNew && cur) {
      cur.pageEnd = p.page;
      continue;
    }
    if (cur && p.startsMidPage) {
      cur.pageEnd = Math.max(cur.pageEnd, p.page);
    } else if (cur && cur.pageEnd >= p.page) {
      cur.pageEnd = p.page - 1;
    }
    counters[p.kind] = (counters[p.kind] ?? 0) + 1;
    cur = {
      kind: p.kind,
      title: title || `${UNIT_KIND_LABELS[p.kind]} ${counters[p.kind]}`,
      pageStart: p.page,
      pageEnd: p.page,
    };
    spans.push(cur);
  }
  return spans.filter((s) => s.pageEnd >= s.pageStart);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

// ---------- Fusion des extractions par lots ----------

export interface ExtractedQuestion {
  label: string;
  statementMd: string;
  figurePages: number[];
  dependsOnPrevious: boolean;
  points: number | null;
  inlineSolutionMd: string | null;
}

export interface ExtractedExercise {
  title: string;
  continuesPrevious: boolean;
  contextMd: string;
  questions: ExtractedQuestion[];
}

export function mergeExerciseBatches(batches: ExtractedExercise[][]): ExtractedExercise[] {
  const out: ExtractedExercise[] = [];
  for (const batch of batches) {
    for (const ex of batch) {
      const last = out[out.length - 1];
      if (ex.continuesPrevious && last) {
        if (ex.contextMd.trim()) last.contextMd = [last.contextMd, ex.contextMd].filter(Boolean).join('\n\n');
        last.questions.push(...ex.questions);
      } else {
        out.push({ ...ex, questions: [...ex.questions] });
      }
    }
  }
  // Exercice sans question : on transforme son énoncé en une question unique.
  for (const ex of out) {
    if (ex.questions.length === 0 && ex.contextMd.trim()) {
      ex.questions.push({
        label: '1',
        statementMd: ex.contextMd,
        figurePages: [],
        dependsOnPrevious: false,
        points: null,
        inlineSolutionMd: null,
      });
      ex.contextMd = '';
    }
  }
  return out.filter((e) => e.questions.length > 0);
}

export interface ExtractedSection {
  title: string;
  pageStart: number;
  pageEnd: number;
  summary: string;
  keyConcepts: string[];
  contentMd: string;
  continuesPrevious: boolean;
}

export function mergeSectionBatches(batches: ExtractedSection[][]): ExtractedSection[] {
  const out: ExtractedSection[] = [];
  for (const batch of batches) {
    for (const s of batch) {
      const last = out[out.length - 1];
      if (s.continuesPrevious && last) {
        last.contentMd = `${last.contentMd}\n\n${s.contentMd}`;
        last.pageEnd = Math.max(last.pageEnd, s.pageEnd);
        last.keyConcepts = [...new Set([...last.keyConcepts, ...s.keyConcepts])];
        if (s.summary && !last.summary.includes(s.summary)) last.summary = `${last.summary} ${s.summary}`.trim();
      } else {
        out.push({ ...s, keyConcepts: [...s.keyConcepts] });
      }
    }
  }
  return out;
}

/** Normalise un label de question/exercice pour la comparaison (« Q1.a) » → « 1a »). */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/exercice|question|ex\.?|q(?=\d)/g, '')
    .replace(/[^a-z0-9]/g, '');
}
