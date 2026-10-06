import { and, asc, desc, eq } from 'drizzle-orm';
import type { ReportQuestion } from '@tpassist/shared';
import { runAgent, type ContentBlock } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { ReportExerciseSchema, ReportSummarySchema, type ReportSummary } from '../ai/schemas';
import { db, newId } from '../db/client';
import { orderedQuestions } from '../db/repo';
import { attempts, courseSections, reports, sessionQuestions, sessions, units } from '../db/schema';
import { answerBlocks, cachedSolution, setCache } from '../services/tutor';
import { helpLabels, isStruggle, struggleWeight } from '../services/struggle';
import { recordOutcome, reportDifficulty, weakPointsForPrompt } from '../services/weakPoints';
import { registerJobHandler, type JobContext, type JobRow } from './queue';

function minutes(ms: number) {
  const m = Math.round(ms / 60000);
  return m < 1 ? "moins d'une minute" : `${m} min`;
}

async function generateReport(job: JobRow, ctx: JobContext) {
  const sessionId = job.refId!;
  const s = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!s) return;
  const unit = db.select().from(units).where(eq(units.id, s.unitId)).get();
  if (!unit) return;
  const isEi = unit.kind === 'ei';

  let report = db.select().from(reports).where(eq(reports.sessionId, sessionId)).orderBy(desc(reports.createdAt)).get();
  if (!report || report.status === 'ready') {
    report = db.insert(reports).values({ id: newId(), sessionId, status: 'pending' }).returning().get();
  } else {
    db.update(reports).set({ status: 'pending', error: null }).where(eq(reports.id, report.id)).run();
  }
  const reportId = report.id;

  try {
    const rows = orderedQuestions(unit.id);
    const sqs = new Map(
      db
        .select()
        .from(sessionQuestions)
        .where(eq(sessionQuestions.sessionId, sessionId))
        .all()
        .map((sq) => [sq.questionId, sq]),
    );
    const allAttempts = db.select().from(attempts).where(eq(attempts.sessionId, sessionId)).orderBy(asc(attempts.createdAt)).all();

    // Regroupement par exercice.
    const byExercise = new Map<string, typeof rows>();
    for (const r of rows) byExercise.set(r.ex.id, [...(byExercise.get(r.ex.id) ?? []), r]);

    const results: ReportQuestion[] = [];
    let i = 0;
    for (const group of byExercise.values()) {
      ctx.progress(0.05 + (0.75 * i++) / byExercise.size, `Bilan : ${group[0].ex.title}…`);
      const blocks: ContentBlock[] = [
        {
          type: 'text',
          text: `Séance : ${unit.title} (${isEi ? `évaluation notée${s.mode === 'ei_examen' ? ', passée en mode examen sans aide' : ' avec aides'}` : unit.kind.toUpperCase()}).\n\n## ${group[0].ex.title}\n${group[0].ex.contextMd ? `### Énoncé commun\n${group[0].ex.contextMd}` : ''}`,
        },
      ];
      for (const { q } of group) {
        const sq = sqs.get(q.id);
        const ref = cachedSolution(q.id);
        const official = q.officialSolutionMd?.trim();
        const refText = official
          ? `Corrigé officiel (à reprendre fidèlement) :\n${official}`
          : ref
            ? `Solution de référence :\n${ref.contentMd}`
            : 'Solution de référence : absente, rédige-la.';
        const qa = allAttempts.filter((a) => a.questionId === q.id);
        blocks.push({
          type: 'text',
          text: [
            `---\n### Question ${q.label} (questionId: ${q.id})${q.points != null ? ` — barème : ${q.points} pt` : ''}`,
            q.statementMd,
            `Statut : ${sq?.status ?? 'non vue'} ; temps passé : ${minutes(sq?.activeMs ?? 0)} ; aides : ${sq ? helpLabels(sq.flags).join(', ') || 'aucune' : 'aucune'}`,
            refText,
            qa.length === 0 ? "Tentatives de l'étudiant : aucune." : `Tentatives de l'étudiant (${qa.length}) :`,
          ].join('\n\n'),
        });
        for (const [k, a] of qa.entries()) {
          blocks.push(...(await answerBlocks({ type: a.type, text: a.answerText, code: a.code, codeLang: a.codeLang, imagePath: a.imagePath }, `Tentative ${k + 1}`)));
          if (a.verdict !== 'pending') {
            blocks.push({
              type: 'text',
              text: `Verdict : ${a.verdict}${a.hidden?.errorLocation ? ` ; passage fautif : « ${a.hidden.errorLocation} »` : ''}${a.hidden?.errorExplanation ? ` ; explication : ${a.hidden.errorExplanation}` : ''}`,
            });
          }
        }
      }

      const r = await runAgent({
        task: 'report.exercise',
        kind: 'generate',
        system: PROMPTS.reportExercise,
        content: blocks,
        schema: ReportExerciseSchema,
        effort: 'high',
        mock: () => ({
          questions: group.map(({ q }) => {
            const qa = allAttempts.filter((a) => a.questionId === q.id);
            const max = isEi ? (q.points ?? 2) : null;
            return {
              questionId: q.id,
              explanationMd:
                qa.length === 0
                  ? "**Bilan (simulation)** : tu n'as pas proposé de réponse. Reprends la démarche attendue ci-dessous."
                  : `**Bilan (simulation)** : ${qa.length} tentative(s). ${qa.some((a) => a.verdict === 'correct') ? 'Ta réponse finale est correcte.' : 'Ta démarche contient une erreur de méthode.'}`,
              solutionMd: q.officialSolutionMd ?? cachedSolution(q.id)?.contentMd ?? `Solution simulée de la question ${q.label}.`,
              score: isEi ? (qa.some((a) => a.answerText && !a.answerText.toLowerCase().includes('faux')) ? max : 0) : null,
              maxScore: max,
            };
          }),
        }),
      });

      const byId = new Map(r.data.questions.map((x) => [x.questionId, x]));
      for (const { q, ex } of group) {
        const out = byId.get(q.id);
        const sq = sqs.get(q.id);
        const solutionMd = out?.solutionMd || cachedSolution(q.id)?.contentMd || q.officialSolutionMd || '';
        if (solutionMd && !cachedSolution(q.id)) setCache(q.id, 'solution', solutionMd, { source: q.officialSolutionMd ? 'official' : 'ai' });
        const qa = allAttempts.filter((a) => a.questionId === q.id);
        results.push({
          questionId: q.id,
          label: q.label,
          exerciseTitle: ex.title,
          contextMd: ex.contextMd,
          statementMd: q.statementMd,
          status: sq?.status ?? 'unseen',
          attempts: qa.map((a) => ({
            type: a.type,
            text: a.answerText,
            code: a.code,
            codeLang: a.codeLang,
            imageUrl: a.imagePath ? `/api/attempts/${a.id}/image` : null,
            verdict: a.verdict,
            errorLocation: a.hidden?.errorLocation ?? null,
            errorExplanation: a.hidden?.errorExplanation ?? null,
          })),
          helps: sq ? helpLabels(sq.flags) : [],
          activeMs: sq?.activeMs ?? 0,
          explanationMd: out?.explanationMd ?? '',
          solutionMd,
          solutionSource: q.officialSolutionMd ? 'official' : 'ai',
          score: isEi ? (out?.score ?? 0) : null,
          maxScore: isEi ? (out?.maxScore ?? q.points ?? 1) : null,
        });
      }
    }

    // Notation des EI : statut des questions, note sur 20, suivi des points bloquants travaillés.
    let score: number | null = null;
    if (isEi) {
      const total = results.reduce((a, r) => a + (r.maxScore ?? 0), 0);
      const got = results.reduce((a, r) => a + Math.min(r.score ?? 0, r.maxScore ?? 0), 0);
      score = total > 0 ? Math.round((got / total) * 200) / 10 : 0;
      for (const r of results) {
        const ratio = r.maxScore ? (r.score ?? 0) / r.maxScore : 0;
        const sq = sqs.get(r.questionId);
        if (!sq) continue;
        if (s.mode === 'ei_examen') {
          const status = r.attempts.length === 0 ? 'skipped' : ratio >= 0.75 ? 'correct' : 'wrong';
          const flags = { ...sq.flags, wrongAttempts: status === 'wrong' ? Math.max(1, sq.flags.wrongAttempts) : sq.flags.wrongAttempts, selfStruggle: sq.flags.selfStruggle || status === 'skipped' };
          db.update(sessionQuestions)
            .set({ status, flags, closed: true })
            .where(and(eq(sessionQuestions.sessionId, sessionId), eq(sessionQuestions.questionId, r.questionId)))
            .run();
          sqs.set(r.questionId, { ...sq, status, flags });
          r.status = status;
        }
        const q = rows.find((x) => x.q.id === r.questionId)?.q;
        if (q?.weakPointId) recordOutcome(q.weakPointId, ratio >= 0.75 ? 'success' : 'failure', 'ei', unit.title);
      }
    }

    // Synthèse et points bloquants.
    ctx.progress(0.85, 'Synthèse et points bloquants…');
    const wps = weakPointsForPrompt(unit.courseId, 30);
    const sections = db
      .select({ id: courseSections.id, title: courseSections.title })
      .from(courseSections)
      .where(eq(courseSections.courseId, unit.courseId))
      .all();
    const summaryInput = results.map((r) => ({
      questionId: r.questionId,
      question: `${r.exerciseTitle} — ${r.label}`,
      statut: r.status,
      aides: r.helps,
      score: r.score,
      maxScore: r.maxScore,
      difficulte: struggleWeight(sqs.get(r.questionId)?.flags ?? { reformulate: false, courseRefs: false, hint: false, solution: false, selfStruggle: false, wrongAttempts: 0, chat: 0 }),
      bilan: r.explanationMd.slice(0, 600),
    }));
    const struggled = results.filter((r) => {
      const f = sqs.get(r.questionId)?.flags;
      return f ? isStruggle(f) : false;
    });
    const summary = await runAgent<ReportSummary>({
      task: 'report.summary',
      kind: 'generate',
      system: PROMPTS.reportSummary,
      content: `Séance : ${unit.title}${score !== null ? ` — note : ${score}/20` : ''}\n\nQuestions :\n${JSON.stringify(summaryInput, null, 1)}\n\nPoints bloquants déjà connus :\n${JSON.stringify(wps, null, 1)}\n\nSections du cours (ids) :\n${JSON.stringify(sections, null, 1)}`,
      schema: ReportSummarySchema,
      effort: 'high',
      mock: () => ({
        strengthsMd: '- Tu as traité les questions dans l’ordre (simulation).',
        overallMd: struggled.length ? 'Revois les notions des questions où tu as eu du mal (simulation).' : 'Très bonne séance (simulation).',
        blockingPoints: struggled.length
          ? [
              {
                existingWeakPointId: wps[0]?.id ?? null,
                notion: `Méthode de « ${struggled[0].exerciseTitle} »`,
                descriptionMd: 'Difficulté à appliquer la méthode du cours (simulation).',
                sectionIds: sections.slice(0, 1).map((x) => x.id),
                questionIds: struggled.map((r) => r.questionId),
              },
            ]
          : [],
      }),
    });

    const sectionIds = new Set(sections.map((x) => x.id));
    const questionIds = new Set(results.map((r) => r.questionId));
    const blockingPoints = summary.data.blockingPoints.map((bp) => {
      const weakPointId = reportDifficulty(
        unit.courseId,
        {
          existingWeakPointId: bp.existingWeakPointId && wps.some((w) => w.id === bp.existingWeakPointId) ? bp.existingWeakPointId : null,
          notion: bp.notion,
          descriptionMd: bp.descriptionMd,
          sectionIds: bp.sectionIds.filter((x) => sectionIds.has(x)),
          questionIds: bp.questionIds.filter((x) => questionIds.has(x)),
        },
        `bilan:${unit.title}`,
      );
      return { weakPointId, notion: bp.notion, descriptionMd: bp.descriptionMd };
    });

    db.update(reports)
      .set({
        status: 'ready',
        score,
        content: { strengthsMd: summary.data.strengthsMd, overallMd: summary.data.overallMd, blockingPoints, questions: results },
      })
      .where(eq(reports.id, reportId))
      .run();
    db.update(sessions).set({ status: 'done', score, updatedAt: Date.now() }).where(eq(sessions.id, sessionId)).run();
  } catch (err) {
    db.update(reports)
      .set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      .where(eq(reports.id, reportId))
      .run();
    throw err;
  }
}

registerJobHandler('report', generateReport);
