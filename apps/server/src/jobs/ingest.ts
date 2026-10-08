// Tâche « ingest » : analyse d'un PDF. Chaque page est classée par l'IA (cours, TD, TP, EI, corrigé), les pages
// contiguës sont regroupées en parties, puis chaque partie est transcrite (voir extractUnit.ts). Les corrigés sont
// ensuite rattachés à leur sujet. Une réanalyse recrée les parties détectées mais garde celles ajoutées à la main.
import { eq } from 'drizzle-orm';
import { UNIT_KIND_LABELS } from '@tpassist/shared';
import { runAgent, type ContentBlock } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { SegmentationSchema } from '../ai/schemas';
import { db } from '../db/client';
import { deleteUnits, documentUnitIds } from '../db/repo';
import { documents } from '../db/schema';
import { classifyPageText, mockSegmentation } from '../ingest/mockHeuristics';
import { mergePagesIntoUnits, type PageClass } from '../ingest/segment';
import { pdfPageCount, pdfPagesText, renderPages } from '../pdf/render';
import { chunk, errorText, range } from '../utils';
import { createUnitFromSpan, maybeEnqueueLinkCorrections, pagesContent } from './extractUnit';
import { registerJobHandler, type JobContext, type JobRow } from './queue';

/** Pages classées par appel (miniatures). */
const SEGMENT_BATCH = 20;

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

    // Réanalyse : les parties détectées sont recréées, celles ajoutées à la main sont gardées.
    deleteUnits(documentUnitIds(documentId, { keepManual: true }));

    for (const [i, span] of spans.entries()) {
      ctx.progress(0.4 + (0.55 * i) / spans.length, `Extraction : ${span.title} (${UNIT_KIND_LABELS[span.kind]}, p. ${span.pageStart}–${span.pageEnd})…`);
      await createUnitFromSpan(doc, texts, span, 'imported');
    }

    db.update(documents).set({ status: 'ready' }).where(eq(documents.id, documentId)).run();
    ctx.progress(0.98, 'Rattachement des corrigés…');
    maybeEnqueueLinkCorrections(doc.courseId);
  } catch (err) {
    db.update(documents)
      .set({ status: 'error', error: errorText(err) })
      .where(eq(documents.id, documentId))
      .run();
    throw err;
  }
}

registerJobHandler('ingest', ingest);
