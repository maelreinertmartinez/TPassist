import { asc, eq, inArray } from 'drizzle-orm';
import { runAgent } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { QuizGenSchema, type QuizGen } from '../ai/schemas';
import { courseToolsServer } from '../ai/tools/courseTools';
import { db, newId } from '../db/client';
import { orderedQuestions } from '../db/repo';
import { courseSections, questions, quizItems, quizzes, sessionQuestions, sessions, units } from '../db/schema';
import { struggleWeight } from '../services/struggle';
import { cachedSolution } from '../services/tutor';
import { weakPointsForPrompt } from '../services/weakPoints';
import { registerJobHandler, type JobContext, type JobRow } from './queue';

export const WEAK_POINT_SHARE = 0.6;

/** Répartit n items entre les points bloquants au prorata de leur priorité. */
export function allocateWeakPointItems(points: { id: string; priority: number }[], n: number): Record<string, number> {
  const out: Record<string, number> = {};
  const total = points.reduce((a, p) => a + Math.max(1, p.priority), 0);
  if (n <= 0 || points.length === 0) return out;
  let assigned = 0;
  const shares = points.map((p) => ({ id: p.id, exact: (n * Math.max(1, p.priority)) / total }));
  for (const s of shares) {
    out[s.id] = Math.floor(s.exact);
    assigned += out[s.id];
  }
  // Reste attribué aux plus grandes parties fractionnaires.
  shares.sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)));
  for (let i = 0; assigned < n; i = (i + 1) % shares.length) {
    out[shares[i].id]++;
    assigned++;
  }
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k];
  return out;
}

function mockQuiz(n: number, wps: { id: string; notion: string }[], sources: { id: string; label: string; statement: string }[]): QuizGen {
  const items: QuizGen['items'] = [];
  const nWeak = wps.length ? Math.round(n * WEAK_POINT_SHARE) : 0;
  for (let i = 0; i < n; i++) {
    const wp = i < nWeak ? wps[i % wps.length] : null;
    const src = sources.length ? sources[i % sources.length] : null;
    const mcq = i % 3 !== 2;
    const topic = wp ? wp.notion : src ? `la question ${src.label}` : 'le cours';
    items.push({
      type: mcq ? 'mcq' : 'open',
      promptMd: mcq ? `(Simulation) Quelle affirmation est correcte à propos de ${topic} ?` : `(Simulation) Explique en une phrase la méthode liée à ${topic}.`,
      choices: mcq ? ['La bonne réponse', 'Un distracteur', 'Un autre distracteur', 'Aucune de ces réponses'] : [],
      correctIndex: mcq ? 0 : null,
      expectedAnswerMd: mcq ? null : 'Appliquer la définition du cours (simulation).',
      explanationMd: 'Explication simulée de la bonne réponse.',
      sourceQuestionId: src?.id ?? null,
      weakPointId: wp?.id ?? null,
    });
  }
  return { title: 'Quiz (simulation)', items };
}

async function generateQuiz(job: JobRow, ctx: JobContext) {
  const quizId = job.refId!;
  const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get();
  if (!quiz) return;
  const size = Number(job.payload.size ?? 10);
  const wps = weakPointsForPrompt(quiz.courseId, 15);
  const nWeak = wps.length ? Math.round(size * WEAK_POINT_SHARE) : 0;
  const allocation = allocateWeakPointItems(wps, nWeak);

  try {
    ctx.progress(0.1, 'Préparation du quiz…');
    let material = '';
    let sources: { id: string; label: string; statement: string }[] = [];
    let unitId: string | undefined;

    if (quiz.kind === 'tp_review' && quiz.sessionId) {
      const s = db.select().from(sessions).where(eq(sessions.id, quiz.sessionId)).get();
      unitId = s?.unitId;
      const rows = s ? orderedQuestions(s.unitId) : [];
      const sqs = new Map(
        db
          .select()
          .from(sessionQuestions)
          .where(eq(sessionQuestions.sessionId, quiz.sessionId))
          .all()
          .map((x) => [x.questionId, x]),
      );
      const scored = rows
        .map(({ q, ex }) => ({ q, ex, weight: struggleWeight(sqs.get(q.id)?.flags ?? { reformulate: false, courseRefs: false, hint: false, solution: false, selfStruggle: false, wrongAttempts: 0, chat: 0 }) }))
        .sort((a, b) => b.weight - a.weight);
      const struggled = scored.filter((x) => x.weight > 0);
      const picked = (struggled.length ? struggled : scored).slice(0, 12);
      sources = picked.map(({ q }) => ({ id: q.id, label: q.label, statement: q.statementMd }));
      material = `Questions du TP/TD sur lesquelles l'étudiant a eu du mal (poids de difficulté décroissant) :\n${JSON.stringify(
        picked.map(({ q, ex, weight }) => ({
          questionId: q.id,
          exercice: ex.title,
          contexte: ex.contextMd.slice(0, 800),
          question: `${q.label}. ${q.statementMd}`,
          difficulte: weight,
          solution: (cachedSolution(q.id)?.contentMd ?? q.officialSolutionMd ?? '').slice(0, 1500),
        })),
        null,
        1,
      )}`;
      if (!struggled.length) material += "\n\nAucune difficulté n'a été relevée : fais un quiz court de consolidation sur les notions de ce TP.";
    } else {
      const secs = db
        .select({ id: courseSections.id, title: courseSections.title, summary: courseSections.summary, keyConcepts: courseSections.keyConcepts })
        .from(courseSections)
        .where(eq(courseSections.courseId, quiz.courseId))
        .all();
      const unitRows = db.select({ id: units.id }).from(units).where(eq(units.courseId, quiz.courseId)).all();
      const qs = unitRows.length
        ? db
            .select({ id: questions.id, label: questions.label, statement: questions.statementMd, unitTitle: units.title })
            .from(questions)
            .innerJoin(units, eq(units.id, questions.unitId))
            .where(inArray(questions.unitId, unitRows.map((u) => u.id)))
            .orderBy(asc(units.order), asc(questions.order))
            .limit(60)
            .all()
        : [];
      sources = qs.map((q) => ({ id: q.id, label: q.label, statement: q.statement }));
      material = `Sections du cours :\n${JSON.stringify(secs, null, 1)}\n\nQuestions de TD/TP/EI du cours (pour t'inspirer des types d'exercices) :\n${JSON.stringify(
        qs.map((q) => ({ questionId: q.id, sujet: q.unitTitle, question: `${q.label}. ${q.statement.slice(0, 250)}` })),
        null,
        1,
      )}`;
    }

    const instructions = [
      `Génère exactement ${size} items (environ 60 % de QCM, 40 % de questions ouvertes courtes).`,
      nWeak
        ? `${nWeak} items doivent travailler les points bloquants, avec cette répartition (weakPointId → nombre d'items) : ${JSON.stringify(allocation)}.`
        : "Aucun point bloquant actif : répartis les items sur l'ensemble des notions.",
      `Points bloquants actifs :\n${JSON.stringify(wps, null, 1)}`,
      material,
    ].join('\n\n');

    ctx.progress(0.3, 'Génération des questions…');
    const r = await runAgent({
      task: `quiz.${quiz.kind}`,
      kind: 'generate',
      system: PROMPTS.quiz,
      content: instructions,
      schema: QuizGenSchema,
      mcp: courseToolsServer({ courseId: quiz.courseId, unitId }),
      effort: 'high',
      maxTurns: 20,
      mock: () => mockQuiz(size, wps, sources),
    });

    const wpIds = new Set(wps.map((w) => w.id));
    const sourceIds = new Set(sources.map((s) => s.id));
    const items = r.data.items.slice(0, Math.max(size, 1) + 5);
    items.forEach((it, i) => {
      const validMcq = it.type === 'mcq' && it.choices.length >= 2 && it.correctIndex !== null && it.correctIndex >= 0 && it.correctIndex < it.choices.length;
      db.insert(quizItems)
        .values({
          id: newId(),
          quizId,
          order: i,
          type: validMcq ? 'mcq' : 'open',
          promptMd: it.promptMd,
          choices: validMcq ? it.choices : [],
          correctIndex: validMcq ? it.correctIndex : null,
          expectedAnswerMd: validMcq ? null : (it.expectedAnswerMd ?? it.explanationMd),
          explanationMd: it.explanationMd,
          sourceQuestionId: it.sourceQuestionId && sourceIds.has(it.sourceQuestionId) ? it.sourceQuestionId : null,
          weakPointId: it.weakPointId && wpIds.has(it.weakPointId) ? it.weakPointId : null,
        })
        .run();
    });
    db.update(quizzes)
      .set({ status: 'ready', total: items.length, title: quiz.title || r.data.title })
      .where(eq(quizzes.id, quizId))
      .run();
  } catch (err) {
    db.update(quizzes)
      .set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      .where(eq(quizzes.id, quizId))
      .run();
    throw err;
  }
}

registerJobHandler('quiz', generateQuiz);
