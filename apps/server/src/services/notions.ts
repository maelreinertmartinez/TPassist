// Carte des notions d'un cours (générée sur demande par jobs/generateNotions) et fiches détaillées des notions,
// rédigées par l'IA au premier clic puis gardées en base.
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { NOTION_KIND_LABELS, stripAccents, type JobDto, type NotionDetailDto, type NotionDto, type NotionMapDto } from '@tpassist/shared';
import { runAgent, type ContentBlock } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { courseToolsServer } from '../ai/tools/courseTools';
import { db } from '../db/client';
import { findById } from '../db/repo';
import { courseSections, courses, jobs, notions, units } from '../db/schema';
import { HttpError } from '../errors';
import { enqueueJob, jobDto } from '../jobs/queue';
import { dedupe } from '../utils';
import { activeWeakPoints } from './weakPoints';

type NotionRow = typeof notions.$inferSelect;

/** Minuscules, sans accents ni ponctuation, mots séparés par une espace : sert à comparer des libellés. */
export function normalizeText(s: string): string {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Sections des chapitres de cours (celles dont la carte des notions est tirée). */
function chapterSections(courseId: string) {
  return db
    .select({ s: courseSections, unitTitle: units.title, unitOrder: units.order })
    .from(courseSections)
    .innerJoin(units, eq(units.id, courseSections.unitId))
    .where(and(eq(courseSections.courseId, courseId), eq(units.kind, 'cours')))
    .orderBy(asc(units.order), asc(courseSections.order))
    .all();
}

/** Empreinte des sections de cours : change dès qu'un chapitre ou une section est ajouté, supprimé ou renommé. */
export function sectionsSignature(courseId: string): string | null {
  const rows = chapterSections(courseId).map(({ s }) => `${s.unitId}:${s.id}:${s.title}`);
  if (rows.length === 0) return null;
  return createHash('sha1').update(rows.sort().join('\n')).digest('hex');
}

/**
 * Rattache les points bloquants actifs aux notions.
 * D'abord par le libellé (la notion est citée par le point bloquant, ou l'inverse) ;
 * à défaut, aux notions principales des sections liées au point bloquant.
 */
export function matchWeakPoints(
  list: { id: string; title: string; parentId: string | null; sectionIds: string[] }[],
  wps: { id: string; notion: string; descriptionMd: string; sectionIds: string[] }[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (notionId: string, wpId: string) => out.set(notionId, [...(out.get(notionId) ?? []), wpId]);
  const titles = list.map((n) => ({ n, t: ` ${normalizeText(n.title)} ` }));
  for (const wp of wps) {
    const label = ` ${normalizeText(wp.notion)} `;
    const text = ` ${normalizeText(`${wp.notion} ${wp.descriptionMd}`)} `;
    const byText = titles.filter(({ t }) => (t.trim().length >= 4 && text.includes(t)) || (label.trim().length >= 4 && t.includes(label)));
    if (byText.length) {
      for (const { n } of byText) add(n.id, wp.id);
      continue;
    }
    const secs = new Set(wp.sectionIds);
    for (const n of list) if (!n.parentId && n.sectionIds.some((s) => secs.has(s))) add(n.id, wp.id);
  }
  return out;
}

const loadNotion = (id: string): NotionRow => findById(notions, id, 'Notion');

/**
 * Carte des notions d'un cours, avec la dernière génération demandée et un indicateur « périmée »
 * quand les chapitres ont changé depuis. Les références vers des notions ou sections disparues sont filtrées.
 */
export function getNotionMap(courseId: string): NotionMapDto {
  const course = findById(courses, courseId, 'Cours');
  const rows = db
    .select({ n: notions })
    .from(notions)
    .innerJoin(units, eq(units.id, notions.unitId))
    .where(eq(notions.courseId, courseId))
    .orderBy(asc(units.order), asc(notions.order))
    .all()
    .map((r) => r.n);
  const ids = new Set(rows.map((n) => n.id));
  const sectionIds = new Set(chapterSections(courseId).map(({ s }) => s.id));
  const list = rows.map((n) => ({
    ...n,
    parentId: n.parentId && ids.has(n.parentId) ? n.parentId : null,
    sectionIds: n.sectionIds.filter((s) => sectionIds.has(s)),
    prerequisiteIds: n.prerequisiteIds.filter((p) => ids.has(p) && p !== n.id),
  }));
  const matched = matchWeakPoints(list, activeWeakPoints(courseId));
  const job = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, 'notions'), eq(jobs.courseId, courseId)))
    .orderBy(desc(jobs.createdAt))
    .get();
  const generated = course.notionsGeneratedAt !== null;
  return {
    notions: list.map(
      (n): NotionDto => ({
        id: n.id,
        unitId: n.unitId,
        parentId: n.parentId,
        order: n.order,
        title: n.title,
        summary: n.summary,
        kind: n.kind,
        sectionIds: n.sectionIds,
        prerequisiteIds: n.prerequisiteIds,
        weakPointIds: matched.get(n.id) ?? [],
      }),
    ),
    job: job ? jobDto(job) : null,
    stale: generated && course.notionsSignature !== sectionsSignature(courseId),
    generatedAt: course.notionsGeneratedAt,
  };
}

/**
 * Lance la génération de la carte des notions (sur demande uniquement) ; renvoie la tâche déjà en cours s'il y en a une.
 * @throws HttpError 400 si le cours n'a aucun chapitre de cours
 */
export function requestNotionMap(courseId: string): JobDto {
  findById(courses, courseId, 'Cours');
  if (chapterSections(courseId).length === 0) throw new HttpError(400, 'Ajoute d’abord un chapitre de cours : la carte des notions est tirée de son contenu.');
  const pending = db
    .select()
    .from(jobs)
    .where(and(eq(jobs.type, 'notions'), eq(jobs.courseId, courseId), inArray(jobs.status, ['queued', 'running'])))
    .get();
  return jobDto(pending ?? enqueueJob({ type: 'notions', courseId, refId: courseId }));
}

function linkedSections(n: NotionRow): NotionDetailDto['sections'] {
  if (n.sectionIds.length === 0) return [];
  return db
    .select({ s: courseSections, unitTitle: units.title })
    .from(courseSections)
    .innerJoin(units, eq(units.id, courseSections.unitId))
    .where(and(inArray(courseSections.id, n.sectionIds), eq(courseSections.courseId, n.courseId)))
    .orderBy(asc(units.order), asc(courseSections.order))
    .all()
    .map(({ s, unitTitle }) => ({ id: s.id, title: s.title, unitTitle, pageStart: s.pageStart, pageEnd: s.pageEnd, contentMd: s.contentMd }));
}

/** Fiche d'une notion (si déjà rédigée) et texte des sections du cours où elle est présentée. */
export function getNotionDetail(id: string): NotionDetailDto {
  const n = loadNotion(id);
  return { id: n.id, detailMd: n.detailMd, sections: linkedSections(n) };
}

const SECTION_LIMIT = 6000;
const TOTAL_LIMIT = 20000;

/** Contenu envoyé à l'IA pour rédiger la fiche : la notion, ses voisines dans la carte et le texte des sections liées. */
function detailContent(n: NotionRow, sections: NotionDetailDto['sections']): ContentBlock[] {
  const others = db
    .select({ id: notions.id, title: notions.title, parentId: notions.parentId })
    .from(notions)
    .where(eq(notions.courseId, n.courseId))
    .all();
  const byId = new Map(others.map((o) => [o.id, o]));
  const chapter = db.select({ title: units.title }).from(units).where(eq(units.id, n.unitId)).get();
  const lines = [
    `# Notion : ${n.title} (${NOTION_KIND_LABELS[n.kind]})`,
    `Chapitre : ${chapter?.title ?? '?'}`,
    n.parentId && byId.get(n.parentId) ? `Notion principale : ${byId.get(n.parentId)!.title}` : null,
    n.summary ? `Résumé : ${n.summary}` : null,
    n.prerequisiteIds.length ? `Prérequis : ${n.prerequisiteIds.map((p) => byId.get(p)?.title).filter(Boolean).join(', ')}` : null,
    (() => {
      const children = others.filter((o) => o.parentId === n.id).map((o) => o.title);
      return children.length ? `Sous-notions : ${children.join(', ')}` : null;
    })(),
  ].filter(Boolean);
  let budget = TOTAL_LIMIT;
  const secs: string[] = [];
  for (const s of sections) {
    if (budget <= 0) break;
    const body = s.contentMd.slice(0, Math.min(SECTION_LIMIT, budget));
    budget -= body.length;
    secs.push(`### ${s.title} — ${s.unitTitle} (p. ${s.pageStart ?? '?'}–${s.pageEnd ?? '?'}, id ${s.id})\n${body}`);
  }
  const text = [lines.join('\n'), secs.length ? `## Sections du cours liées\n\n${secs.join('\n\n')}` : '## Aucune section liée : cherche la notion dans le cours.'].join('\n\n');
  return [{ type: 'text', text }];
}

function mockDetail(n: NotionRow): string {
  return [
    `### Définition / énoncé`,
    `(Simulation) **${n.title}** : ${n.summary || 'notion du cours.'}`,
    `### Formules et propriétés clés`,
    `$$f(x) = \\sum_{k=0}^{n} a_k x^k$$`,
    `### Méthode`,
    `1. Identifier les hypothèses.\n2. Appliquer la définition.\n3. Conclure.`,
    `### Pièges fréquents`,
    `- Oublier une hypothèse.`,
  ].join('\n\n');
}

/** Fiche détaillée d'une notion : générée au premier clic, puis gardée en cache. */
export async function streamNotionDetail(id: string, refresh: boolean, onText?: (d: string) => void) {
  const n = loadNotion(id);
  if (n.detailMd && !refresh) return { id, detailMd: n.detailMd, cached: true };
  return dedupe(`notion:${id}`, async () => {
    const r = await runAgent<string>({
      task: 'notions.detail',
      kind: 'tutor',
      system: PROMPTS.notionDetail,
      content: detailContent(n, linkedSections(n)),
      mcp: courseToolsServer({ courseId: n.courseId }),
      effort: 'medium',
      onText,
      mock: () => mockDetail(n),
    });
    const detailMd = r.text.trim();
    db.update(notions).set({ detailMd }).where(eq(notions.id, id)).run();
    return { id, detailMd, cached: false };
  });
}
