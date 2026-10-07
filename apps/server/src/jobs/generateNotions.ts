// Tâche « notions » : construit la carte des notions d'un cours, un appel IA par chapitre (dans l'ordre du cours,
// pour que les prérequis puissent viser les chapitres précédents), puis remplace l'ancienne carte d'un coup.
import { asc, eq } from 'drizzle-orm';
import type { NotionKind } from '@tpassist/shared';
import { runAgent } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { NotionMapSchema, type NotionMap } from '../ai/schemas';
import { db, newId } from '../db/client';
import { courseSections, courses, notions } from '../db/schema';
import { courseUnits } from '../db/repo';
import { normalizeText, sectionsSignature } from '../services/notions';
import { registerJobHandler, type JobContext, type JobRow } from './queue';

type RawNotion = NotionMap['notions'][number];
type Section = typeof courseSections.$inferSelect;

/** Notion validée, avec des références vérifiées. */
export interface CleanNotion {
  key: string;
  title: string;
  summary: string;
  kind: NotionKind;
  parentKey: string | null;
  sectionIds: string[];
  prerequisiteKeys: string[];
}

const MAX_PREREQUISITES = 3;
const SECTION_LIMIT = 4000;
const CHAPTER_LIMIT = 40000;

function slug(s: string) {
  return normalizeText(s).replace(/ /g, '-').slice(0, 48) || 'notion';
}

/**
 * Nettoie la carte renvoyée par l'IA pour un chapitre :
 * clés uniques, parent du même chapitre sur 2 niveaux au plus (sans cycle),
 * sections et prérequis connus uniquement, pas d'auto-référence.
 */
export function sanitizeNotions(raw: RawNotion[], validSectionIds: Set<string>, knownKeys: Set<string>): CleanNotion[] {
  const local = new Map<string, RawNotion>();
  for (const n of raw) {
    const title = n.title.trim();
    if (!title) continue;
    const key = n.key.trim() || slug(title);
    if (!local.has(key)) local.set(key, { ...n, key, title });
  }
  const parentOf = new Map<string, string | null>();
  for (const n of local.values()) {
    const p = n.parentKey?.trim() || null;
    parentOf.set(n.key, p && p !== n.key && local.has(p) ? p : null);
  }
  const out: CleanNotion[] = [];
  for (const n of local.values()) {
    let parentKey = parentOf.get(n.key) ?? null;
    if (parentKey && parentOf.get(parentKey)) {
      // Troisième niveau : on remonte au grand-parent s'il est une notion principale, sinon la notion devient principale.
      const grand = parentOf.get(parentKey)!;
      parentKey = grand !== n.key && !parentOf.get(grand) ? grand : null;
    }
    const prerequisiteKeys = [...new Set(n.prerequisiteKeys.map((k) => k.trim()))]
      .filter((k) => k !== n.key && (local.has(k) || knownKeys.has(k)))
      .slice(0, MAX_PREREQUISITES);
    out.push({
      key: n.key,
      title: n.title,
      summary: n.summary.trim(),
      kind: n.kind,
      parentKey,
      sectionIds: [...new Set(n.sectionIds)].filter((s) => validSectionIds.has(s)),
      prerequisiteKeys,
    });
  }
  return out;
}

function guessKind(label: string): NotionKind {
  const t = normalizeText(label);
  if (/\b(theoreme|lemme|corollaire)\b/.test(t)) return 'theoreme';
  if (/\b(definition)\b/.test(t)) return 'definition';
  if (/\b(methode|algorithme)\b/.test(t)) return 'methode';
  if (/\b(formule|relation)\b/.test(t)) return 'formule';
  if (/\b(propriete)\b/.test(t)) return 'propriete';
  return 'concept';
}

/** Carte simulée : une notion par section, ses notions clés en sous-notions. */
function mockNotionMap(sections: Section[], known: { key: string }[]): NotionMap {
  const out: RawNotion[] = [];
  let previous = known[known.length - 1]?.key ?? null;
  sections.forEach((s, i) => {
    const key = `${slug(s.title)}-${s.id.slice(0, 6)}`;
    out.push({
      key,
      title: s.title.split(/\s+/).slice(0, 6).join(' '),
      summary: s.summary.split(/(?<=\.)\s/)[0] ?? '',
      kind: guessKind(s.title),
      parentKey: null,
      sectionIds: [s.id],
      prerequisiteKeys: previous ? [previous] : [],
    });
    s.keyConcepts.slice(0, 4).forEach((k, j) => {
      out.push({ key: `${key}-${j}`, title: k, summary: '', kind: guessKind(k), parentKey: key, sectionIds: [s.id], prerequisiteKeys: [] });
    });
    previous = i % 2 === 0 ? key : previous;
  });
  return { notions: out };
}

function chapterContent(chapter: { title: string }, sections: Section[], known: { key: string; title: string; chapter: string }[]): string {
  let budget = CHAPTER_LIMIT;
  const secs = sections.map((s) => {
    const content = s.contentMd.slice(0, Math.max(0, Math.min(SECTION_LIMIT, budget)));
    budget -= content.length;
    return { id: s.id, titre: s.title, resume: s.summary, notionsCles: s.keyConcepts, contenu: content };
  });
  return [
    `Chapitre : « ${chapter.title} »`,
    `Notions des chapitres précédents (clés utilisables dans prerequisiteKeys) :\n${known.length ? JSON.stringify(known, null, 1) : 'aucune'}`,
    `Sections du chapitre :\n${JSON.stringify(secs, null, 1)}`,
  ].join('\n\n');
}

/** Génère et enregistre la carte des notions d’un cours (gestionnaire de la tâche « notions »). */
export async function generateNotions(job: JobRow, ctx: JobContext) {
  const courseId = job.courseId!;
  const chapters = courseUnits(courseId, ['cours']);
  const sections = db.select().from(courseSections).where(eq(courseSections.courseId, courseId)).orderBy(asc(courseSections.order)).all();
  const withSections = chapters.filter((c) => sections.some((s) => s.unitId === c.id));
  if (withSections.length === 0) throw new Error('Aucun chapitre de cours à analyser.');
  const signature = sectionsSignature(courseId);

  const known: { key: string; title: string; chapter: string }[] = [];
  const idByKey = new Map<string, string>();
  const rows: (typeof notions.$inferInsert)[] = [];

  for (const [i, chapter] of withSections.entries()) {
    ctx.progress(0.05 + (0.9 * i) / withSections.length, `Notions de « ${chapter.title} »…`);
    const chSecs = sections.filter((s) => s.unitId === chapter.id);
    const r = await runAgent({
      task: 'notions.map',
      kind: 'generate',
      system: PROMPTS.notionMap,
      content: chapterContent(chapter, chSecs, known),
      schema: NotionMapSchema,
      effort: 'medium',
      mock: () => mockNotionMap(chSecs, known),
    });
    const clean = sanitizeNotions(r.data.notions, new Set(chSecs.map((s) => s.id)), new Set(known.map((k) => k.key)));
    // Les clés locales priment ; une clé déjà vue dans un chapitre précédent désigne la notion de ce chapitre-là.
    const localIds = new Map(clean.map((n) => [n.key, newId()]));
    clean.forEach((n, order) => {
      rows.push({
        id: localIds.get(n.key)!,
        courseId,
        unitId: chapter.id,
        parentId: n.parentKey ? localIds.get(n.parentKey)! : null,
        order,
        title: n.title,
        summary: n.summary,
        kind: n.kind,
        sectionIds: n.sectionIds,
        prerequisiteIds: n.prerequisiteKeys.map((k) => localIds.get(k) ?? idByKey.get(k)!).filter(Boolean),
      });
    });
    for (const n of clean) {
      if (!idByKey.has(n.key)) {
        idByKey.set(n.key, localIds.get(n.key)!);
        known.push({ key: n.key, title: n.title, chapter: chapter.title });
      }
    }
  }

  ctx.progress(0.97, 'Enregistrement de la carte…');
  db.transaction((tx) => {
    // Les fiches déjà rédigées sont gardées pour les notions qui n'ont pas changé de nom.
    const kept = new Map(
      tx
        .select({ unitId: notions.unitId, title: notions.title, detailMd: notions.detailMd })
        .from(notions)
        .where(eq(notions.courseId, courseId))
        .all()
        .filter((o) => o.detailMd)
        .map((o) => [`${o.unitId}|${normalizeText(o.title)}`, o.detailMd]),
    );
    tx.delete(notions).where(eq(notions.courseId, courseId)).run();
    for (const row of rows) {
      tx.insert(notions)
        .values({ ...row, detailMd: kept.get(`${row.unitId}|${normalizeText(row.title)}`) ?? null })
        .run();
    }
    tx.update(courses).set({ notionsSignature: signature, notionsGeneratedAt: Date.now() }).where(eq(courses.id, courseId)).run();
  });
}

registerJobHandler('notions', generateNotions);
