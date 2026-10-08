// Transcription d'une partie d'un PDF (cours, TD, TP, EI ou corrigé) à partir de ses pages, par lots : utilisée par
// l'analyse automatique (une fois par partie détectée) et par la tâche « extract_unit » (pages choisies à la main
// dans un document déjà analysé). La partie n'est créée en base qu'une fois toute son extraction terminée.
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { PLAYABLE_KINDS, UNIT_KIND_LABELS, type AddUnitFromPagesBody, type UnitOrigin } from '@tpassist/shared';
import { runAgent, type ContentBlock } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { CorrigeExtractionSchema, CourseExtractionSchema, ExerciseExtractionSchema, type CorrigeExtraction } from '../ai/schemas';
import { db, newId } from '../db/client';
import { courseUnits, insertExercises, insertSection, nextOrder } from '../db/repo';
import { documents, units } from '../db/schema';
import { mockExtractCorrige, mockExtractCours, mockExtractExercises } from '../ingest/mockHeuristics';
import { mergeExerciseBatches, mergeSectionBatches, type ExtractedExercise, type ExtractedSection, type UnitSpan } from '../ingest/segment';
import { pageImagePath, pdfPagesText, readPageBase64, renderPages } from '../pdf/render';
import { chunk, range } from '../utils';
import { enqueueJob, hasPendingJob, registerJobHandler, type JobContext, type JobRow } from './queue';

/** Pages transcrites par appel (pleine résolution). */
const EXTRACT_BATCH = 12;
/** Longueur maximale de la couche texte envoyée pour une page. */
const PAGE_TEXT_LIMIT = 3500;

function pageText(texts: string[], page: number) {
  return (texts[page - 1] ?? '').slice(0, PAGE_TEXT_LIMIT);
}

/** Couche texte et image de chaque page, à envoyer à l'IA. */
export async function pagesContent(
  documentId: string,
  texts: string[],
  pages: number[],
  variant: 'full' | 'thumb',
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  for (const p of pages) {
    blocks.push({ type: 'text', text: `=== Page ${p} — couche texte ===\n${pageText(texts, p) || '(pas de texte extractible : page scannée ou image)'}` });
    blocks.push({ type: 'image', mediaType: 'image/png', data: await readPageBase64(documentId, p, variant) });
  }
  return blocks;
}

function sharedPageNote(span: UnitSpan) {
  return `Partie à extraire : « ${span.title} » (type ${UNIT_KIND_LABELS[span.kind]}), pages ${span.pageStart} à ${span.pageEnd}. La première et la dernière page peuvent contenir aussi la fin ou le début d'une autre partie : ignore ce qui n'appartient pas à « ${span.title} ».`;
}

async function extractCours(documentId: string, texts: string[], span: UnitSpan): Promise<ExtractedSection[]> {
  const batches: ExtractedSection[][] = [];
  for (const pages of chunk(range(span.pageStart, span.pageEnd), EXTRACT_BATCH)) {
    const done = batches.flat();
    const prevInfo = done.length ? `Sections déjà extraites (lots précédents) : ${done.map((s) => `« ${s.title} »`).join(', ')}. La dernière peut continuer dans ce lot.` : '';
    const r = await runAgent({
      task: 'ingest.cours',
      kind: 'ingest',
      system: PROMPTS.extractCours,
      content: [
        { type: 'text', text: `${sharedPageNote(span)}\nLot : pages ${pages[0]} à ${pages[pages.length - 1]}. ${prevInfo}` },
        ...(await pagesContent(documentId, texts, pages, 'full')),
      ],
      schema: CourseExtractionSchema,
      effort: 'medium',
      mock: () => mockExtractCours(pages.map((p) => ({ page: p, text: texts[p - 1] ?? '' }))),
    });
    batches.push(r.data.sections);
  }
  return mergeSectionBatches(batches);
}

async function extractExercises(documentId: string, texts: string[], span: UnitSpan) {
  const batches: ExtractedExercise[][] = [];
  let durationMinutes: number | null = null;
  for (const pages of chunk(range(span.pageStart, span.pageEnd), EXTRACT_BATCH)) {
    const done = batches.flat();
    const prevInfo = done.length
      ? `Déjà extrait (lots précédents) : ${done.map((e) => `${e.title} [questions ${e.questions.map((q) => q.label).join(', ')}]`).join(' ; ')}. Le dernier exercice peut continuer dans ce lot.`
      : '';
    const r = await runAgent({
      task: `ingest.${span.kind}`,
      kind: 'ingest',
      system: PROMPTS.extractExercises,
      content: [
        { type: 'text', text: `${sharedPageNote(span)}\nLot : pages ${pages[0]} à ${pages[pages.length - 1]}. ${prevInfo}` },
        ...(await pagesContent(documentId, texts, pages, 'full')),
      ],
      schema: ExerciseExtractionSchema,
      effort: 'medium',
      mock: () => mockExtractExercises(pages.map((p) => ({ page: p, text: texts[p - 1] ?? '' })), span.kind),
    });
    durationMinutes ??= r.data.durationMinutes;
    batches.push(r.data.exercises);
  }
  return { durationMinutes, exercises: mergeExerciseBatches(batches) };
}

async function extractCorrige(documentId: string, texts: string[], span: UnitSpan): Promise<CorrigeExtraction> {
  let targetTitle = '';
  const solutions: CorrigeExtraction['solutions'] = [];
  for (const pages of chunk(range(span.pageStart, span.pageEnd), EXTRACT_BATCH)) {
    const r = await runAgent({
      task: 'ingest.corrige',
      kind: 'ingest',
      system: PROMPTS.extractCorrige,
      content: [
        { type: 'text', text: `${sharedPageNote(span)}\nLot : pages ${pages[0]} à ${pages[pages.length - 1]}.` },
        ...(await pagesContent(documentId, texts, pages, 'full')),
      ],
      schema: CorrigeExtractionSchema,
      effort: 'medium',
      mock: () => mockExtractCorrige(pages.map((p) => ({ page: p, text: texts[p - 1] ?? '' }))),
    });
    targetTitle ||= r.data.targetTitle;
    solutions.push(...r.data.solutions);
  }
  return { targetTitle, solutions };
}

/**
 * Transcrit une partie d'un document (sections d'un cours, exercices d'un TD/TP/EI ou solutions d'un corrigé)
 * puis la crée à la fin du cours. Les images des pages doivent déjà être rendues.
 * @returns l'id de la partie créée
 */
export async function createUnitFromSpan(doc: { id: string; courseId: string }, texts: string[], span: UnitSpan, origin: UnitOrigin): Promise<string> {
  const unitId = newId();
  const base = () => ({
    id: unitId,
    courseId: doc.courseId,
    documentId: doc.id,
    kind: span.kind,
    title: span.title,
    origin,
    // Calculé à l'insertion : plusieurs extractions peuvent tourner en même temps sur le cours.
    order: nextOrder(units.order, eq(units.courseId, doc.courseId)),
    pageStart: span.pageStart,
    pageEnd: span.pageEnd,
  });
  if (span.kind === 'cours') {
    const sections = await extractCours(doc.id, texts, span);
    db.insert(units).values({ ...base(), meta: {} }).run();
    sections.forEach((s, j) => insertSection({ unitId, courseId: doc.courseId, order: j, ...s }));
  } else if (span.kind === 'corrige') {
    const c = await extractCorrige(doc.id, texts, span);
    db.insert(units)
      .values({ ...base(), meta: { targetTitle: c.targetTitle, solutions: c.solutions.map((s) => ({ ...s, matchedQuestionId: null })) } })
      .run();
  } else {
    const { durationMinutes, exercises } = await extractExercises(doc.id, texts, span);
    db.insert(units)
      .values({ ...base(), meta: { durationMinutes } })
      .run();
    insertExercises(
      unitId,
      doc.id,
      exercises.map((e) => ({
        title: e.title,
        contextMd: e.contextMd,
        questions: e.questions.map((q) => ({ ...q, officialSolutionMd: q.inlineSolutionMd })),
      })),
    );
  }
  return unitId;
}

/** Lance le rattachement s'il existe des corrigés non rattachés et des sujets candidats (une seule tâche à la fois). */
export function maybeEnqueueLinkCorrections(courseId: string) {
  const pending = courseUnits(courseId, ['corrige']).some((u) => !u.correctsUnitId);
  if (!pending || courseUnits(courseId, PLAYABLE_KINDS).length === 0) return;
  if (hasPendingJob('link_corrections', { courseId })) return;
  enqueueJob({ type: 'link_corrections', courseId, refId: courseId });
}

/** Tâche « extract_unit » : crée une partie à partir de pages choisies à la main (`refId` : le document). */
export async function extractUnit(job: JobRow, ctx: JobContext) {
  const doc = db.select().from(documents).where(eq(documents.id, job.refId!)).get();
  // Document supprimé entre-temps : plus rien à faire.
  if (!doc) return;
  const { kind, title, pageStart, pageEnd } = job.payload as unknown as AddUnitFromPagesBody;
  const span: UnitSpan = { kind, title, pageStart, pageEnd };

  ctx.progress(0.05, `Extraction de « ${title} » (${UNIT_KIND_LABELS[kind]}, p. ${pageStart}–${pageEnd})…`);
  const texts = doc.pagesText ?? (await pdfPagesText(doc.path));
  if (range(pageStart, pageEnd).some((p) => !existsSync(pageImagePath(doc.id, p, 'full')))) {
    ctx.progress(0.1, 'Rendu des pages…');
    await renderPages(doc.path, doc.id);
  }
  await createUnitFromSpan(doc, texts, span, 'manual');

  ctx.progress(0.95, 'Rattachement des corrigés…');
  maybeEnqueueLinkCorrections(doc.courseId);
}

registerJobHandler('extract_unit', extractUnit);
