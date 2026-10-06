import { and, eq, inArray, isNull } from 'drizzle-orm';
import { UNIT_KIND_LABELS, type UnitKind } from '@tpassist/shared';
import { runAgent, type ContentBlock } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import {
  CorrigeExtractionSchema,
  CourseExtractionSchema,
  ExerciseExtractionSchema,
  SegmentationSchema,
  type CorrigeExtraction,
} from '../ai/schemas';
import { db, newId } from '../db/client';
import { deleteUnits, insertExercises, insertSection, nextUnitOrder } from '../db/repo';
import { documents, units } from '../db/schema';
import { classifyPageText, mockExtractCorrige, mockExtractCours, mockExtractExercises, mockSegmentation } from '../ingest/mockHeuristics';
import {
  chunk,
  mergeExerciseBatches,
  mergePagesIntoUnits,
  mergeSectionBatches,
  range,
  type ExtractedExercise,
  type ExtractedSection,
  type PageClass,
  type UnitSpan,
} from '../ingest/segment';
import { pdfPageCount, pdfPagesText, readPageBase64, renderPages } from '../pdf/render';
import { enqueueJob, hasPendingJob, registerJobHandler, type JobContext, type JobRow } from './queue';

const SEGMENT_BATCH = 20;
const EXTRACT_BATCH = 12;
const PAGE_TEXT_LIMIT = 3500;

function pageText(texts: string[], page: number) {
  return (texts[page - 1] ?? '').slice(0, PAGE_TEXT_LIMIT);
}

async function pagesContent(
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

async function segment(documentId: string, texts: string[], pageCount: number, ctx: JobContext): Promise<PageClass[]> {
  const batches = chunk(range(1, pageCount), SEGMENT_BATCH);
  const all: PageClass[] = [];
  for (const [i, pages] of batches.entries()) {
    ctx.progress(0.08 + (0.3 * i) / batches.length, `Détection des parties (pages ${pages[0]}–${pages[pages.length - 1]})…`);
    const prev = all[all.length - 1] ?? null;
    const intro = prev
      ? `Contexte : la page ${prev.page} (lot précédent) appartient à « ${prev.unitTitle} » (type ${prev.kind}).`
      : 'Ce lot commence au début du document.';
    const content: ContentBlock[] = [
      { type: 'text', text: `${intro}\nClasse chacune des pages ${pages[0]} à ${pages[pages.length - 1]}.` },
      ...(await pagesContent(documentId, texts, pages, 'thumb')),
    ];
    const r = await runAgent({
      task: 'ingest.segment',
      kind: 'ingest',
      system: PROMPTS.segmentation,
      content,
      schema: SegmentationSchema,
      effort: 'medium',
      mock: () => ({ pages: mockSegmentation(pages.map((p) => ({ page: p, text: texts[p - 1] ?? '' })), prev) }),
    });
    const byPage = new Map(r.data.pages.map((p) => [p.page, p]));
    for (const p of pages) {
      const c = byPage.get(p);
      all.push(
        c ?? {
          page: p,
          kind: prev?.kind ?? classifyPageText(texts[p - 1] ?? ''),
          unitTitle: prev?.unitTitle ?? '',
          startsNewUnit: false,
          startsMidPage: false,
        },
      );
    }
  }
  return all;
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

async function ingest(job: JobRow, ctx: JobContext) {
  const documentId = job.refId!;
  const doc = db.select().from(documents).where(eq(documents.id, documentId)).get();
  if (!doc) return;
  db.update(documents).set({ status: 'processing', error: null }).where(eq(documents.id, documentId)).run();

  try {
    ctx.progress(0.02, 'Lecture du PDF…');
    const pageCount = await pdfPageCount(doc.path);
    const texts = await pdfPagesText(doc.path);
    db.update(documents).set({ pageCount, pagesText: texts }).where(eq(documents.id, documentId)).run();

    ctx.progress(0.05, 'Rendu des pages…');
    await renderPages(doc.path, documentId);

    const classes = await segment(documentId, texts, pageCount, ctx);
    const spans = mergePagesIntoUnits(classes);
    if (spans.length === 0) throw new Error('Aucune partie exploitable détectée dans ce PDF.');

    // Réanalyse : on repart de zéro pour ce document.
    const old = db.select({ id: units.id }).from(units).where(eq(units.documentId, documentId)).all();
    deleteUnits(old.map((u) => u.id));

    let order = nextUnitOrder(doc.courseId);
    for (const [i, span] of spans.entries()) {
      ctx.progress(0.4 + (0.55 * i) / spans.length, `Extraction : ${span.title} (${UNIT_KIND_LABELS[span.kind]}, p. ${span.pageStart}–${span.pageEnd})…`);
      const unitId = newId();
      const base = {
        id: unitId,
        courseId: doc.courseId,
        documentId,
        kind: span.kind as UnitKind,
        title: span.title,
        order: order++,
        pageStart: span.pageStart,
        pageEnd: span.pageEnd,
      };
      if (span.kind === 'cours') {
        const sections = await extractCours(documentId, texts, span);
        db.insert(units).values({ ...base, meta: {} }).run();
        sections.forEach((s, j) => insertSection({ unitId, courseId: doc.courseId, order: j, ...s }));
      } else if (span.kind === 'corrige') {
        const c = await extractCorrige(documentId, texts, span);
        db.insert(units)
          .values({ ...base, meta: { targetTitle: c.targetTitle, solutions: c.solutions.map((s) => ({ ...s, matchedQuestionId: null })) } })
          .run();
      } else {
        const { durationMinutes, exercises } = await extractExercises(documentId, texts, span);
        db.insert(units)
          .values({ ...base, meta: { durationMinutes } })
          .run();
        insertExercises(
          unitId,
          documentId,
          exercises.map((e) => ({
            title: e.title,
            contextMd: e.contextMd,
            questions: e.questions.map((q) => ({ ...q, officialSolutionMd: q.inlineSolutionMd })),
          })),
        );
      }
    }

    db.update(documents).set({ status: 'ready' }).where(eq(documents.id, documentId)).run();
    ctx.progress(0.98, 'Rattachement des corrigés…');
    maybeEnqueueLinkCorrections(doc.courseId);
  } catch (err) {
    db.update(documents)
      .set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      .where(eq(documents.id, documentId))
      .run();
    throw err;
  }
}

/** Lance le rattachement s'il existe des corrigés non rattachés et des sujets candidats. */
export function maybeEnqueueLinkCorrections(courseId: string) {
  const pending = db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.courseId, courseId), eq(units.kind, 'corrige'), isNull(units.correctsUnitId)))
    .all();
  if (pending.length === 0) return;
  const targets = db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.courseId, courseId), inArray(units.kind, ['td', 'tp', 'ei'])))
    .all();
  if (targets.length === 0) return;
  if (hasPendingJob('link_corrections', { courseId })) return;
  enqueueJob({ type: 'link_corrections', courseId, refId: courseId });
}

registerJobHandler('ingest', ingest);
