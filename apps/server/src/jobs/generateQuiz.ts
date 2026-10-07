// Tâche « quiz » : rédige les questions d'un quiz (révision d'une séance ou quiz complet du cours),
// avec environ 60 % des questions consacrées aux points bloquants, répartis selon leur priorité.
import { asc, eq } from 'drizzle-orm';
import { EMPTY_FLAGS } from '@tpassist/shared';
import { runAgent } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { QuizGenSchema, type QuizGen } from '../ai/schemas';
import { courseToolsServer } from '../ai/tools/courseTools';
import { db, newId } from '../db/client';
import { findById, orderedQuestions } from '../db/repo';
import { courseSections, questions, quizItems, quizzes, sessionQuestions, sessions, units } from '../db/schema';
import { struggleWeight } from '../services/struggle';
import { cachedSolution } from '../services/tutor';
import { allocateWeakPointItems, WEAK_POINT_SHARE, weakPointsForPrompt } from '../services/weakPoints';
import { errorText } from '../utils';
import { registerJobHandler, type JobContext, type JobRow } from './queue';

type Source = { id: string; label: string; statement: string };

/** Matière envoyée à l'IA et questions d'origine dont les items peuvent s'inspirer. */
interface QuizMaterial {
  material: string;
  sources: Source[];
  unitId?: string;
}

/** Quiz de révision : les questions de la séance où l'étudiant a eu le plus de mal (12 au plus). */
function reviewMaterial(sessionId: string): QuizMaterial {
  const s = findById(sessions, sessionId, 'Session');
  const sqs = new Map(
    db
      .select()
      .from(sessionQuestions)
      .where(eq(sessionQuestions.sessionId, sessionId))
      .all()
      .map((x) => [x.questionId, x]),
  );
  const scored = orderedQuestions(s.unitId)
    .map(({ q, ex }) => ({ q, ex, weight: struggleWeight(sqs.get(q.id)?.flags ?? EMPTY_FLAGS) }))
    .sort((a, b) => b.weight - a.weight);
  const struggled = scored.filter((x) => x.weight > 0);
  const picked = (struggled.length ? struggled : scored).slice(0, 12);
  const questionsJson = JSON.stringify(
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
  );
  return {
    unitId: s.unitId,
    sources: picked.map(({ q }) => ({ id: q.id, label: q.label, statement: q.statementMd })),
    material: [
      `Questions du TP/TD sur lesquelles l'étudiant a eu du mal (poids de difficulté décroissant) :\n${questionsJson}`,
      struggled.length ? '' : "Aucune difficulté n'a été relevée : fais un quiz court de consolidation sur les notions de ce TP.",
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}

/** Quiz complet : les sections du cours et des exemples de questions de TD/TP/EI (60 au plus). */
function courseMaterial(courseId: string): QuizMaterial {
  const secs = db
    .select({ id: courseSections.id, title: courseSections.title, summary: courseSections.summary, keyConcepts: courseSections.keyConcepts })
    .from(courseSections)
    .where(eq(courseSections.courseId, courseId))
    .all();
  const qs = db
    .select({ id: questions.id, label: questions.label, statement: questions.statementMd, unitTitle: units.title })
    .from(questions)
    .innerJoin(units, eq(units.id, questions.unitId))
    .where(eq(units.courseId, courseId))
    .orderBy(asc(units.order), asc(questions.order))
    .limit(60)
    .all();
  const examples = qs.map((q) => ({ questionId: q.id, sujet: q.unitTitle, question: `${q.label}. ${q.statement.slice(0, 250)}` }));
  return {
    sources: qs.map((q) => ({ id: q.id, label: q.label, statement: q.statement })),
    material: `Sections du cours :\n${JSON.stringify(secs, null, 1)}\n\nQuestions de TD/TP/EI du cours (pour t'inspirer des types d'exercices) :\n${JSON.stringify(examples, null, 1)}`,
  };
}

/** Quiz simulé : environ 2/3 de QCM, les premiers items sur les points bloquants. */
function mockQuiz(n: number, wps: { id: string; notion: string }[], sources: Source[]): QuizGen {
  const nWeak = wps.length ? Math.round(n * WEAK_POINT_SHARE) : 0;
  const items: QuizGen['items'] = Array.from({ length: n }, (_, i) => {
    const wp = i < nWeak ? wps[i % wps.length] : null;
    const src = sources.length ? sources[i % sources.length] : null;
    const mcq = i % 3 !== 2;
    const topic = wp ? wp.notion : src ? `la question ${src.label}` : 'le cours';
    return {
      type: mcq ? 'mcq' : 'open',
      promptMd: mcq ? `(Simulation) Quelle affirmation est correcte à propos de ${topic} ?` : `(Simulation) Explique en une phrase la méthode liée à ${topic}.`,
      choices: mcq ? ['La bonne réponse', 'Un distracteur', 'Un autre distracteur', 'Aucune de ces réponses'] : [],
      correctIndex: mcq ? 0 : null,
      expectedAnswerMd: mcq ? null : 'Appliquer la définition du cours (simulation).',
      explanationMd: 'Explication simulée de la bonne réponse.',
      sourceQuestionId: src?.id ?? null,
      weakPointId: wp?.id ?? null,
    };
  });
  return { title: 'Quiz (simulation)', items };
}

/** Enregistre les items ; un QCM mal formé devient une question ouverte, les références inconnues sont retirées. */
function saveItems(quizId: string, items: QuizGen['items'], sourceIds: Set<string>, wpIds: Set<string>) {
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
}

async function generateQuiz(job: JobRow, ctx: JobContext) {
  const quizId = job.refId!;
  const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get();
  if (!quiz) return;
  const size = Number(job.payload.size ?? 10);
  const wps = weakPointsForPrompt(quiz.courseId, 15);
  const nWeak = wps.length ? Math.round(size * WEAK_POINT_SHARE) : 0;

  try {
    ctx.progress(0.1, 'Préparation du quiz…');
    const { material, sources, unitId } = quiz.kind === 'tp_review' && quiz.sessionId ? reviewMaterial(quiz.sessionId) : courseMaterial(quiz.courseId);
    const instructions = [
      `Génère exactement ${size} items (environ 60 % de QCM, 40 % de questions ouvertes courtes).`,
      nWeak
        ? `${nWeak} items doivent travailler les points bloquants, avec cette répartition (weakPointId → nombre d'items) : ${JSON.stringify(allocateWeakPointItems(wps, nWeak))}.`
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

    // L'IA peut produire quelques items de trop : on en garde au plus 5 de plus que demandé.
    const items = r.data.items.slice(0, Math.max(size, 1) + 5);
    saveItems(quizId, items, new Set(sources.map((s) => s.id)), new Set(wps.map((w) => w.id)));
    db.update(quizzes)
      .set({ status: 'ready', total: items.length, title: quiz.title || r.data.title })
      .where(eq(quizzes.id, quizId))
      .run();
  } catch (err) {
    db.update(quizzes).set({ status: 'error', error: errorText(err) }).where(eq(quizzes.id, quizId)).run();
    throw err;
  }
}

registerJobHandler('quiz', generateQuiz);
