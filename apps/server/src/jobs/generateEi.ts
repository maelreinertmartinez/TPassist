import { and, asc, eq, inArray } from 'drizzle-orm';
import { runAgent } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { EiGenSchema, type EiGen } from '../ai/schemas';
import { courseToolsServer } from '../ai/tools/courseTools';
import { db, newId } from '../db/client';
import { insertExercises, nextUnitOrder, orderedQuestions } from '../db/repo';
import { courseSections, questions, units } from '../db/schema';
import { setCache } from '../services/tutor';
import { weakPointsForPrompt } from '../services/weakPoints';
import { allocateWeakPointItems, WEAK_POINT_SHARE } from './generateQuiz';
import { registerJobHandler, type JobContext, type JobRow } from './queue';

function mockEi(wps: { id: string; notion: string }[]): EiGen {
  const q = (label: string, i: number) => ({
    label,
    statementMd: `(Simulation) Question ${label} : applique la méthode du cours${wps[i % Math.max(1, wps.length)] ? ` sur « ${wps[i % wps.length].notion} »` : ''}.`,
    points: 5,
    solutionMd: `Solution simulée de la question ${label}.`,
    weakPointId: wps.length && i < 3 ? wps[i % wps.length].id : null,
  });
  return {
    title: 'EI blanche générée (simulation)',
    durationMinutes: 90,
    exercises: [
      { title: 'Exercice 1', contextMd: 'Données simulées de l’exercice 1.', questions: [q('1', 0), q('2', 1)] },
      { title: 'Exercice 2', contextMd: 'Données simulées de l’exercice 2.', questions: [q('1', 2), q('2', 3)] },
    ],
  };
}

async function generateEi(job: JobRow, ctx: JobContext) {
  const courseId = job.courseId!;
  const difficulty = String(job.payload.difficulty ?? 'standard');
  const sectionIds = Array.isArray(job.payload.sectionIds) ? (job.payload.sectionIds as string[]) : [];

  ctx.progress(0.05, 'Analyse des EI existantes…');
  const eiUnits = db
    .select()
    .from(units)
    .where(and(eq(units.courseId, courseId), eq(units.kind, 'ei')))
    .orderBy(asc(units.order))
    .all();
  const models = (eiUnits.some((u) => u.origin === 'imported') ? eiUnits.filter((u) => u.origin === 'imported') : eiUnits).slice(0, 4);
  if (models.length === 0) throw new Error('Ajoute au moins une EI au cours pour pouvoir en générer de nouvelles.');

  const modelsJson = models.map((u) => {
    const rows = orderedQuestions(u.id);
    const exs = new Map<string, { title: string; context: string; questions: { label: string; statement: string; points: number | null }[] }>();
    for (const { q, ex } of rows) {
      if (!exs.has(ex.id)) exs.set(ex.id, { title: ex.title, context: ex.contextMd.slice(0, 1500), questions: [] });
      exs.get(ex.id)!.questions.push({ label: q.label, statement: q.statementMd.slice(0, 700), points: q.points });
    }
    return { title: u.title, durationMinutes: u.meta.durationMinutes ?? null, exercises: [...exs.values()] };
  });

  const tdtp = db
    .select({ id: units.id, title: units.title })
    .from(units)
    .where(and(eq(units.courseId, courseId), inArray(units.kind, ['td', 'tp'])))
    .all();
  const tdtpQuestions = tdtp.length
    ? db
        .select({ label: questions.label, statement: questions.statementMd, unitId: questions.unitId })
        .from(questions)
        .where(inArray(questions.unitId, tdtp.map((u) => u.id)))
        .limit(60)
        .all()
        .map((q) => ({ sujet: tdtp.find((u) => u.id === q.unitId)?.title, question: `${q.label}. ${q.statement.slice(0, 200)}` }))
    : [];
  const focus = sectionIds.length
    ? db.select({ id: courseSections.id, title: courseSections.title }).from(courseSections).where(inArray(courseSections.id, sectionIds)).all()
    : [];
  const wps = weakPointsForPrompt(courseId, 12);
  const allocation = allocateWeakPointItems(wps, Math.round(20 * WEAK_POINT_SHARE));

  const content = [
    `Difficulté souhaitée : ${difficulty}.`,
    focus.length ? `Chapitres à couvrir en priorité : ${focus.map((f) => `${f.title} (${f.id})`).join(', ')}.` : 'Couvre l’ensemble du cours.',
    wps.length
      ? `Points bloquants à privilégier (au moins 60 % du barème ; points de barème indicatifs par point bloquant : ${JSON.stringify(allocation)}) :\n${JSON.stringify(wps, null, 1)}`
      : 'Aucun point bloquant actif.',
    `EI existantes (modèles de style, de structure et de barème) :\n${JSON.stringify(modelsJson, null, 1)}`,
    tdtpQuestions.length ? `Exemples de questions de TD/TP (types d'exercices vus) :\n${JSON.stringify(tdtpQuestions, null, 1)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  ctx.progress(0.2, 'Rédaction de la nouvelle EI…');
  const r = await runAgent({
    task: 'ei.generate',
    kind: 'generate',
    system: PROMPTS.generateEi,
    content,
    schema: EiGenSchema,
    mcp: courseToolsServer({ courseId }),
    effort: 'high',
    maxTurns: 30,
    mock: () => mockEi(wps),
  });

  ctx.progress(0.9, 'Enregistrement…');
  const wpIds = new Set(wps.map((w) => w.id));
  const unitId = newId();
  const generatedCount = eiUnits.filter((u) => u.origin === 'generated').length + 1;
  db.insert(units)
    .values({
      id: unitId,
      courseId,
      documentId: null,
      kind: 'ei',
      title: r.data.title || `EI blanche générée n°${generatedCount}`,
      order: nextUnitOrder(courseId),
      origin: 'generated',
      meta: { durationMinutes: r.data.durationMinutes, generation: { difficulty, sectionIds, basedOn: models.map((m) => m.id) } },
    })
    .run();
  const created = insertExercises(
    unitId,
    null,
    r.data.exercises.map((e) => ({
      title: e.title,
      contextMd: e.contextMd,
      questions: e.questions.map((q) => ({
        label: q.label,
        statementMd: q.statementMd,
        figurePages: [],
        dependsOnPrevious: false,
        points: q.points,
        weakPointId: q.weakPointId && wpIds.has(q.weakPointId) ? q.weakPointId : null,
      })),
    })),
  );
  r.data.exercises.forEach((e, i) =>
    e.questions.forEach((q, j) => {
      const qid = created[i]?.questionIds[j];
      if (qid && q.solutionMd) setCache(qid, 'solution', q.solutionMd, { source: 'ai' });
    }),
  );
}

registerJobHandler('generate_ei', generateEi);
