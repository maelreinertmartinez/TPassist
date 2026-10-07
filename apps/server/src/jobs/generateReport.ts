// Tâche « report » : rédige le bilan d'une séance terminée.
// 1. Un appel IA par exercice : explication de chaque réponse, solution, et note pour une EI.
// 2. EI : note sur 20, statuts des questions (mode examen) et suivi des points bloquants travaillés.
// 3. Un appel IA de synthèse : points forts, conseils et points bloquants (créés ou renforcés).
import { and, asc, eq } from 'drizzle-orm';
import { EMPTY_FLAGS, type QuestionFlags, type ReportQuestion } from '@tpassist/shared';
import { runAgent, type ContentBlock } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { ReportExerciseSchema, ReportSummarySchema, type ReportSummary } from '../ai/schemas';
import { db, newId } from '../db/client';
import { exercisesWithQuestions } from '../db/repo';
import { attempts, courseSections, reports, sessionQuestions, sessions, units } from '../db/schema';
import { latestReport } from '../services/reports';
import { attemptImageUrl } from '../services/sessions';
import { helpLabels, isStruggle, struggleWeight } from '../services/struggle';
import { answerBlocks, cachedSolution, setCache } from '../services/tutor';
import { recordOutcome, reportDifficulty, weakPointsForPrompt } from '../services/weakPoints';
import { errorText, groupBy } from '../utils';
import { registerJobHandler, type JobContext, type JobRow } from './queue';

type SessionRow = typeof sessions.$inferSelect;
type UnitRow = typeof units.$inferSelect;
type SqRow = typeof sessionQuestions.$inferSelect;
type AttemptRow = typeof attempts.$inferSelect;
type Exercise = ReturnType<typeof exercisesWithQuestions>[number];

/** Une réponse vaut « juste » dans une EI à partir de 75 % des points. */
const EI_PASS_RATIO = 0.75;

/** Ce que le bilan sait de la séance. */
interface ReportInput {
  s: SessionRow;
  unit: UnitRow;
  isEi: boolean;
  sqs: Map<string, SqRow>;
  attemptsByQuestion: Map<string, AttemptRow[]>;
}

function minutes(ms: number) {
  const m = Math.round(ms / 60000);
  return m < 1 ? "moins d'une minute" : `${m} min`;
}

/** Contenu envoyé à l'IA pour un exercice : énoncés, solutions de référence, tentatives et verdicts. */
async function exerciseBlocks({ s, unit, isEi, sqs, attemptsByQuestion }: ReportInput, { ex, questions }: Exercise): Promise<ContentBlock[]> {
  const kindLabel = isEi ? `évaluation notée${s.mode === 'ei_examen' ? ', passée en mode examen sans aide' : ' avec aides'}` : unit.kind.toUpperCase();
  const blocks: ContentBlock[] = [
    { type: 'text', text: `Séance : ${unit.title} (${kindLabel}).\n\n## ${ex.title}\n${ex.contextMd ? `### Énoncé commun\n${ex.contextMd}` : ''}` },
  ];
  for (const q of questions) {
    const sq = sqs.get(q.id);
    const official = q.officialSolutionMd?.trim();
    const ref = cachedSolution(q.id);
    const refText = official ? `Corrigé officiel (à reprendre fidèlement) :\n${official}` : ref ? `Solution de référence :\n${ref.contentMd}` : 'Solution de référence : absente, rédige-la.';
    const qa = attemptsByQuestion.get(q.id) ?? [];
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
        const location = a.hidden?.errorLocation ? ` ; passage fautif : « ${a.hidden.errorLocation} »` : '';
        const explanation = a.hidden?.errorExplanation ? ` ; explication : ${a.hidden.errorExplanation}` : '';
        blocks.push({ type: 'text', text: `Verdict : ${a.verdict}${location}${explanation}` });
      }
    }
  }
  return blocks;
}

/** Bilan simulé d'un exercice. */
function mockExercise({ isEi, attemptsByQuestion }: ReportInput, { questions }: Exercise) {
  return {
    questions: questions.map((q) => {
      const qa = attemptsByQuestion.get(q.id) ?? [];
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
  };
}

/** Bilan de chaque question d'un exercice ; la solution retenue est mise en cache si elle ne l'était pas. */
async function reportExercise(input: ReportInput, exercise: Exercise): Promise<ReportQuestion[]> {
  const r = await runAgent({
    task: 'report.exercise',
    kind: 'generate',
    system: PROMPTS.reportExercise,
    content: await exerciseBlocks(input, exercise),
    schema: ReportExerciseSchema,
    effort: 'high',
    mock: () => mockExercise(input, exercise),
  });
  const byId = new Map(r.data.questions.map((x) => [x.questionId, x]));
  return exercise.questions.map((q) => {
    const out = byId.get(q.id);
    const sq = input.sqs.get(q.id);
    const cached = cachedSolution(q.id)?.contentMd;
    const solutionMd = out?.solutionMd || cached || q.officialSolutionMd || '';
    if (solutionMd && !cached) setCache(q.id, 'solution', solutionMd, { source: q.officialSolutionMd ? 'official' : 'ai' });
    return {
      questionId: q.id,
      label: q.label,
      exerciseTitle: exercise.ex.title,
      contextMd: exercise.ex.contextMd,
      statementMd: q.statementMd,
      status: sq?.status ?? 'unseen',
      attempts: (input.attemptsByQuestion.get(q.id) ?? []).map((a) => ({
        type: a.type,
        text: a.answerText,
        code: a.code,
        codeLang: a.codeLang,
        imageUrl: a.imagePath ? attemptImageUrl(a.id) : null,
        verdict: a.verdict,
        errorLocation: a.hidden?.errorLocation ?? null,
        errorExplanation: a.hidden?.errorExplanation ?? null,
      })),
      helps: sq ? helpLabels(sq.flags) : [],
      activeMs: sq?.activeMs ?? 0,
      explanationMd: out?.explanationMd ?? '',
      solutionMd,
      solutionSource: q.officialSolutionMd ? 'official' : 'ai',
      score: input.isEi ? (out?.score ?? 0) : null,
      maxScore: input.isEi ? (out?.maxScore ?? q.points ?? 1) : null,
    };
  });
}

/**
 * Note une EI sur 20. En mode examen, fixe aussi le statut des questions (jusque-là non corrigées).
 * Chaque question liée à un point bloquant compte comme une réussite ou un échec sur ce point.
 */
function gradeEi({ s, unit, sqs }: ReportInput, results: ReportQuestion[], weakPointOf: Map<string, string | null>): number {
  const total = results.reduce((a, r) => a + (r.maxScore ?? 0), 0);
  const got = results.reduce((a, r) => a + Math.min(r.score ?? 0, r.maxScore ?? 0), 0);
  for (const r of results) {
    const ratio = r.maxScore ? (r.score ?? 0) / r.maxScore : 0;
    const sq = sqs.get(r.questionId);
    if (!sq) continue;
    if (s.mode === 'ei_examen') {
      const status = r.attempts.length === 0 ? 'skipped' : ratio >= EI_PASS_RATIO ? 'correct' : 'wrong';
      const flags: QuestionFlags = {
        ...sq.flags,
        wrongAttempts: status === 'wrong' ? Math.max(1, sq.flags.wrongAttempts) : sq.flags.wrongAttempts,
        selfStruggle: sq.flags.selfStruggle || status === 'skipped',
      };
      db.update(sessionQuestions)
        .set({ status, flags, closed: true })
        .where(and(eq(sessionQuestions.sessionId, s.id), eq(sessionQuestions.questionId, r.questionId)))
        .run();
      sqs.set(r.questionId, { ...sq, status, flags });
      r.status = status;
    }
    const weakPointId = weakPointOf.get(r.questionId);
    if (weakPointId) recordOutcome(weakPointId, ratio >= EI_PASS_RATIO ? 'success' : 'failure', 'ei', unit.title);
  }
  return total > 0 ? Math.round((got / total) * 200) / 10 : 0;
}

/** Synthèse de la séance et points bloquants (créés ou renforcés). */
async function summarize({ unit, sqs }: ReportInput, results: ReportQuestion[], score: number | null) {
  const wps = weakPointsForPrompt(unit.courseId, 30);
  const sections = db.select({ id: courseSections.id, title: courseSections.title }).from(courseSections).where(eq(courseSections.courseId, unit.courseId)).all();
  const flagsOf = (questionId: string) => sqs.get(questionId)?.flags ?? EMPTY_FLAGS;
  const summaryInput = results.map((r) => ({
    questionId: r.questionId,
    question: `${r.exerciseTitle} — ${r.label}`,
    statut: r.status,
    aides: r.helps,
    score: r.score,
    maxScore: r.maxScore,
    difficulte: struggleWeight(flagsOf(r.questionId)),
    bilan: r.explanationMd.slice(0, 600),
  }));
  const struggled = results.filter((r) => isStruggle(flagsOf(r.questionId)));
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

  // Les ids inventés par l'IA (point bloquant, section, question) sont écartés.
  const sectionIds = new Set(sections.map((x) => x.id));
  const questionIds = new Set(results.map((r) => r.questionId));
  const blockingPoints = summary.data.blockingPoints.map((bp) => ({
    weakPointId: reportDifficulty(
      unit.courseId,
      {
        existingWeakPointId: bp.existingWeakPointId && wps.some((w) => w.id === bp.existingWeakPointId) ? bp.existingWeakPointId : null,
        notion: bp.notion,
        descriptionMd: bp.descriptionMd,
        sectionIds: bp.sectionIds.filter((x) => sectionIds.has(x)),
        questionIds: bp.questionIds.filter((x) => questionIds.has(x)),
      },
      `bilan:${unit.title}`,
    ),
    notion: bp.notion,
    descriptionMd: bp.descriptionMd,
  }));
  return { strengthsMd: summary.data.strengthsMd, overallMd: summary.data.overallMd, blockingPoints };
}

async function generateReport(job: JobRow, ctx: JobContext) {
  const sessionId = job.refId!;
  const s = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  const unit = s && db.select().from(units).where(eq(units.id, s.unitId)).get();
  if (!s || !unit) return;

  // Un bilan déjà prêt est conservé : on en rédige un nouveau ; sinon on reprend celui en attente ou en erreur.
  let report = latestReport(sessionId);
  if (!report || report.status === 'ready') {
    report = db.insert(reports).values({ id: newId(), sessionId, status: 'pending' }).returning().get();
  } else {
    db.update(reports).set({ status: 'pending', error: null }).where(eq(reports.id, report.id)).run();
  }
  const reportId = report.id;

  try {
    const input: ReportInput = {
      s,
      unit,
      isEi: unit.kind === 'ei',
      sqs: new Map(db.select().from(sessionQuestions).where(eq(sessionQuestions.sessionId, sessionId)).all().map((sq) => [sq.questionId, sq])),
      attemptsByQuestion: groupBy(
        db.select().from(attempts).where(eq(attempts.sessionId, sessionId)).orderBy(asc(attempts.createdAt)).all(),
        (a) => a.questionId,
      ),
    };
    const exercises = exercisesWithQuestions(unit.id).filter((e) => e.questions.length > 0);
    const results: ReportQuestion[] = [];
    for (const [i, exercise] of exercises.entries()) {
      ctx.progress(0.05 + (0.75 * i) / exercises.length, `Bilan : ${exercise.ex.title}…`);
      results.push(...(await reportExercise(input, exercise)));
    }

    const weakPointOf = new Map(exercises.flatMap((e) => e.questions.map((q) => [q.id, q.weakPointId] as const)));
    const score = input.isEi ? gradeEi(input, results, weakPointOf) : null;

    ctx.progress(0.85, 'Synthèse et points bloquants…');
    const synthesis = await summarize(input, results, score);

    db.update(reports)
      .set({ status: 'ready', score, content: { ...synthesis, questions: results } })
      .where(eq(reports.id, reportId))
      .run();
    db.update(sessions).set({ status: 'done', score, updatedAt: Date.now() }).where(eq(sessions.id, sessionId)).run();
  } catch (err) {
    db.update(reports).set({ status: 'error', error: errorText(err) }).where(eq(reports.id, reportId)).run();
    throw err;
  }
}

registerJobHandler('report', generateReport);
