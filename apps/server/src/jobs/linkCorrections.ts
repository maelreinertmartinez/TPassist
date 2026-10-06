import { and, eq, inArray, isNull } from 'drizzle-orm';
import { runAgent } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { LinkCorrectionsSchema } from '../ai/schemas';
import { db } from '../db/client';
import { orderedQuestions } from '../db/repo';
import { questionAiCache, questions, units } from '../db/schema';
import { groupMatchedSolutions, heuristicLinkCorrections, type LinkCorrige, type LinkTarget } from '../ingest/corrections';
import { registerJobHandler, type JobContext, type JobRow } from './queue';

/** Applique le rattachement d'un corrigé à une unité, question par question. */
export function applyCorrigeLink(corrigeUnitId: string, targetUnitId: string | null, matches: { solutionIndex: number; questionId: string }[]) {
  const corrige = db.select().from(units).where(eq(units.id, corrigeUnitId)).get();
  if (!corrige) return;
  const solutions = corrige.meta.solutions ?? [];
  const validIds = targetUnitId ? new Set(orderedQuestions(targetUnitId).map((r) => r.q.id)) : new Set<string>();
  const valid = matches.filter((m) => validIds.has(m.questionId));

  // Retire les solutions précédemment issues de ce corrigé.
  const previous = solutions.map((s) => s.matchedQuestionId).filter((x): x is string => Boolean(x));
  if (previous.length) {
    db.update(questions)
      .set({ officialSolutionMd: null, officialSolutionDocId: null, officialSolutionPages: null })
      .where(and(inArray(questions.id, previous), eq(questions.officialSolutionDocId, corrige.documentId ?? '')))
      .run();
    db.delete(questionAiCache)
      .where(and(inArray(questionAiCache.questionId, previous), eq(questionAiCache.kind, 'solution')))
      .run();
  }

  const grouped = groupMatchedSolutions(solutions, valid);
  for (const [questionId, sol] of grouped) {
    db.update(questions)
      .set({ officialSolutionMd: sol.solutionMd, officialSolutionDocId: corrige.documentId, officialSolutionPages: sol.pages })
      .where(eq(questions.id, questionId))
      .run();
    // La solution affichée sera régénérée à partir du corrigé officiel.
    db.delete(questionAiCache)
      .where(and(eq(questionAiCache.questionId, questionId), eq(questionAiCache.kind, 'solution')))
      .run();
  }
  const byIndex = new Map(valid.map((m) => [m.solutionIndex, m.questionId]));
  db.update(units)
    .set({
      correctsUnitId: targetUnitId,
      meta: { ...corrige.meta, solutions: solutions.map((s, i) => ({ ...s, matchedQuestionId: byIndex.get(i) ?? null })) },
    })
    .where(eq(units.id, corrigeUnitId))
    .run();
}

async function linkCorrections(job: JobRow, ctx: JobContext) {
  const courseId = job.courseId!;
  const pending = db
    .select()
    .from(units)
    .where(and(eq(units.courseId, courseId), eq(units.kind, 'corrige'), isNull(units.correctsUnitId)))
    .all();
  if (pending.length === 0) return;
  const targetRows = db
    .select()
    .from(units)
    .where(and(eq(units.courseId, courseId), inArray(units.kind, ['td', 'tp', 'ei'])))
    .all();
  if (targetRows.length === 0) return;

  const corriges: LinkCorrige[] = pending.map((u) => ({
    id: u.id,
    title: u.title,
    targetTitle: u.meta.targetTitle ?? '',
    solutions: u.meta.solutions ?? [],
  }));
  const targets: (LinkTarget & { kind: string })[] = targetRows.map((u) => ({
    id: u.id,
    kind: u.kind,
    title: u.title,
    questions: orderedQuestions(u.id).map(({ q, ex }) => ({ id: q.id, exerciseTitle: ex.title, label: q.label, statement: q.statementMd.slice(0, 160) })),
  }));

  ctx.progress(0.3, 'Association des corrigés aux sujets…');
  const payload = {
    corriges: corriges.map((c) => ({
      corrigeUnitId: c.id,
      title: c.title,
      targetTitle: c.targetTitle,
      solutions: c.solutions.map((s, i) => ({ index: i, exercise: s.exerciseLabel, question: s.questionLabel, debut: s.solutionMd.slice(0, 160) })),
    })),
    sujets: targets,
  };
  const r = await runAgent({
    task: 'ingest.link_corrections',
    kind: 'ingest',
    system: PROMPTS.linkCorrections,
    content: `Voici les corrigés à rattacher et les sujets du cours (JSON) :\n\n${JSON.stringify(payload, null, 1)}`,
    schema: LinkCorrectionsSchema,
    effort: 'medium',
    mock: () => heuristicLinkCorrections(corriges, targets),
  });

  for (const link of r.data.links) {
    if (!pending.some((p) => p.id === link.corrigeUnitId)) continue;
    if (link.targetUnitId && !targetRows.some((t) => t.id === link.targetUnitId)) continue;
    applyCorrigeLink(link.corrigeUnitId, link.targetUnitId, link.matches);
  }
}

registerJobHandler('link_corrections', linkCorrections);
