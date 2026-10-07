// Aides du tuteur IA sur une question : reformulation, partie de cours, indice, solution et vérification d'une réponse.
// Chaque aide est générée une seule fois par question puis gardée en cache (table question_ai_cache) :
// tous les étudiants et toutes les séances la réutilisent.
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import type { CourseRef, HelpKind, SolutionSource } from '@tpassist/shared';
import { runAgent, type ContentBlock } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { CourseRefsSchema, VerifySchema, type VerifyResult } from '../ai/schemas';
import { courseToolsServer } from '../ai/tools/courseTools';
import { db, ftsSearch } from '../db/client';
import { questionWithContext, type QuestionContext } from '../db/repo';
import { courseSections, questionAiCache, questions, units } from '../db/schema';
import { readPageBase64 } from '../pdf/render';
import { dedupe } from '../utils';
import { imageBlock } from './images';

type CacheData = NonNullable<typeof questionAiCache.$inferSelect.data>;

// ---------- Cache ----------

function getCache(questionId: string, kind: HelpKind) {
  return db
    .select()
    .from(questionAiCache)
    .where(and(eq(questionAiCache.questionId, questionId), eq(questionAiCache.kind, kind)))
    .get();
}

/** Enregistre (ou remplace) une aide générée pour une question. */
export function setCache(questionId: string, kind: HelpKind, contentMd: string, data?: CacheData) {
  db.insert(questionAiCache)
    .values({ questionId, kind, contentMd, data: data ?? null })
    .onConflictDoUpdate({ target: [questionAiCache.questionId, questionAiCache.kind], set: { contentMd, data: data ?? null, createdAt: Date.now() } })
    .run();
}

/** Oublie les aides générées de ces questions (toutes, ou seulement certains types) : elles seront régénérées. */
export function clearAiCache(questionIds: string[], kinds?: HelpKind[]) {
  if (questionIds.length === 0) return;
  db.delete(questionAiCache)
    .where(and(inArray(questionAiCache.questionId, questionIds), kinds ? inArray(questionAiCache.kind, kinds) : undefined))
    .run();
}

// ---------- Énoncé envoyé à l'IA ----------

/** Énoncé de la question, avec l'énoncé commun de l'exercice et les questions précédentes si elle en dépend. */
function questionText(ctx: QuestionContext): string {
  const { q, ex, unit } = ctx;
  const parts = [`## ${unit.title} — ${ex.title}`];
  if (ex.contextMd.trim()) parts.push(`### Énoncé commun de l'exercice\n${ex.contextMd}`);
  if (q.dependsOnPrevious) {
    const prev = db
      .select({ label: questions.label, statementMd: questions.statementMd })
      .from(questions)
      .where(and(eq(questions.exerciseId, ex.id), lt(questions.order, q.order)))
      .orderBy(asc(questions.order))
      .all();
    if (prev.length) parts.push(`### Questions précédentes de l'exercice\n${prev.map((p) => `- ${p.label}. ${p.statementMd}`).join('\n')}`);
  }
  parts.push(`### Question ${q.label}\n${q.statementMd}`);
  return parts.join('\n\n');
}

/** Contenu envoyé à l'IA : énoncé, textes additionnels, figures du sujet (2 au plus), puis blocs additionnels. */
async function questionContent(ctx: QuestionContext, extra: string[] = [], extraBlocks: ContentBlock[] = []): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [{ type: 'text', text: [questionText(ctx), ...extra].join('\n\n') }];
  if (ctx.q.documentId) {
    for (const page of ctx.q.figurePages.slice(0, 2)) {
      try {
        blocks.push({ type: 'text', text: `Figure de l'énoncé (page ${page}) :` });
        blocks.push({ type: 'image', mediaType: 'image/png', data: await readPageBase64(ctx.q.documentId, page, 'full') });
      } catch {
        // page non rendue : on ignore
      }
    }
  }
  return [...blocks, ...extraBlocks];
}

// ---------- Aides textuelles (reformulation, indice, solution) ----------

type TextHelpKind = 'reformulation' | 'hint' | 'solution';

interface TextHelpRequest {
  effort: EffortLevel;
  /** Textes ajoutés après l'énoncé (corrigé officiel, solution de référence…). */
  extra?: string[];
  /** Données gardées en cache avec le texte (origine de la solution). */
  data?: CacheData;
  /** Réponse en mode simulation. */
  mock: () => string;
}

/**
 * Aide textuelle diffusée au fil de l'eau : renvoyée depuis le cache si elle existe, sinon générée une seule fois
 * (les demandes simultanées partagent la même génération) puis mise en cache.
 */
async function cachedTextHelp(
  questionId: string,
  kind: TextHelpKind,
  build: (ctx: QuestionContext) => TextHelpRequest,
  onText?: (delta: string) => void,
): Promise<{ contentMd: string; data: CacheData | null }> {
  const cached = getCache(questionId, kind);
  if (cached) return { contentMd: cached.contentMd, data: cached.data };
  return dedupe(`${questionId}:${kind}`, async () => {
    const ctx = questionWithContext(questionId);
    const req = build(ctx);
    const r = await runAgent<string>({
      task: `tutor.${kind}`,
      kind: 'tutor',
      system: PROMPTS[kind],
      content: await questionContent(ctx, req.extra),
      effort: req.effort,
      onText,
      mock: req.mock,
    });
    setCache(questionId, kind, r.text, req.data);
    return { contentMd: r.text, data: req.data ?? null };
  });
}

/** Reformule l'énoncé avec des mots simples, sans piste de résolution. */
export async function reformulate(questionId: string, onText?: (d: string) => void) {
  return cachedTextHelp(
    questionId,
    'reformulation',
    (ctx) => ({
      effort: 'low',
      mock: () =>
        `**Reformulation (simulation)** — On te demande de traiter la question ${ctx.q.label} :\n\n> ${ctx.q.statementMd.slice(0, 300)}\n\n**Ce qu'on te demande :** comprendre et résoudre cette question avec les données de l'exercice.`,
    }),
    onText,
  );
}

/** Une indication pour débloquer l'étudiant, orientée par la solution de référence si elle est connue. */
export async function hint(questionId: string, onText?: (d: string) => void) {
  return cachedTextHelp(
    questionId,
    'hint',
    (ctx) => {
      const ref = cachedSolution(questionId)?.contentMd ?? ctx.q.officialSolutionMd ?? null;
      return {
        effort: 'medium',
        extra: ref ? [`### Solution de référence (pour orienter l'indication, NE PAS la recopier)\n${ref}`] : [],
        mock: () => `**Indice (simulation)** : repars de la définition vue en cours et applique-la aux données de l'énoncé de la question ${ctx.q.label}.`,
      };
    },
    onText,
  );
}

/** Solution de référence d'une question, et son origine. */
export interface ReferenceSolution {
  contentMd: string;
  source: SolutionSource;
}

/** Solution déjà générée pour une question, sans rien générer. */
export function cachedSolution(questionId: string): ReferenceSolution | null {
  const c = getCache(questionId, 'solution');
  return c ? { contentMd: c.contentMd, source: c.data?.source ?? 'ai' } : null;
}

/** Solution complète et expliquée ; elle suit fidèlement le corrigé officiel quand il existe. */
export async function referenceSolution(questionId: string, onText?: (d: string) => void): Promise<ReferenceSolution> {
  const r = await cachedTextHelp(
    questionId,
    'solution',
    (ctx) => {
      const official = ctx.q.officialSolutionMd?.trim();
      return {
        effort: 'high',
        extra: official ? [`### Corrigé officiel (à suivre fidèlement)\n${official}`] : [],
        data: { source: official ? 'official' : 'ai' },
        mock: () =>
          official
            ? `${official}\n\n**Explications (simulation)** : chaque étape du corrigé officiel applique la méthode du cours.\n\n**À retenir** : relire la définition utilisée.`
            : `**Solution (simulation)** pour la question ${ctx.q.label}.\n\n1. On identifie les données.\n2. On applique la méthode du cours.\n3. On conclut : **résultat attendu**.\n\n**À retenir** : vérifier chaque étape.`,
      };
    },
    onText,
  );
  return { contentMd: r.contentMd, source: r.data?.source ?? 'ai' };
}

// ---------- Partie de cours ----------

/** Complète les références renvoyées par l'IA (titre, chapitre, pages) et écarte les sections inconnues. */
function enrichRefs(refs: { sectionId: string; why: string; excerptMd: string }[], courseId: string): CourseRef[] {
  return refs.flatMap((r) => {
    const s = db
      .select({ s: courseSections, unitTitle: units.title, documentId: units.documentId })
      .from(courseSections)
      .innerJoin(units, eq(units.id, courseSections.unitId))
      .where(and(eq(courseSections.id, r.sectionId), eq(courseSections.courseId, courseId)))
      .get();
    return s
      ? [{ sectionId: r.sectionId, title: s.s.title, unitTitle: s.unitTitle, pageStart: s.s.pageStart, pageEnd: s.s.pageEnd, documentId: s.documentId, why: r.why, excerptMd: r.excerptMd }]
      : [];
  });
}

/** Parties du cours utiles pour la question (1 à 3), trouvées par l'IA avec les outils de lecture du cours. */
export async function courseRefs(questionId: string) {
  const cached = getCache(questionId, 'course_refs');
  if (cached) return { contentMd: cached.contentMd, refs: cached.data?.courseRefs ?? [] };
  return dedupe(`${questionId}:course_refs`, async () => {
    const ctx = questionWithContext(questionId);
    const courseId = ctx.unit.courseId;
    const hasSections = Boolean(db.select({ id: courseSections.id }).from(courseSections).where(eq(courseSections.courseId, courseId)).get());
    let refs: CourseRef[] = [];
    if (hasSections) {
      const r = await runAgent({
        task: 'tutor.course_refs',
        kind: 'tutor',
        system: PROMPTS.courseRefs,
        content: await questionContent(ctx),
        schema: CourseRefsSchema,
        mcp: courseToolsServer({ courseId }),
        effort: 'medium',
        mock: () => {
          const hits = ftsSearch(courseId, `${ctx.q.statementMd} ${ctx.ex.contextMd}`, 2);
          const ids = hits.length
            ? hits.map((h) => h.sectionId)
            : db.select({ id: courseSections.id }).from(courseSections).where(eq(courseSections.courseId, courseId)).limit(2).all().map((s) => s.id);
          return {
            refs: ids.map((id) => ({
              sectionId: id,
              why: 'Cette partie présente la notion utilisée dans la question (simulation).',
              excerptMd: hits.find((h) => h.sectionId === id)?.snippet ?? 'Extrait du cours (simulation).',
            })),
          };
        },
      });
      refs = enrichRefs(r.data.refs, courseId);
    }
    const contentMd = refs.length
      ? ''
      : hasSections
        ? 'Aucune partie du cours importé ne semble directement liée à cette question.'
        : "Aucun cours n'a encore été importé pour ce module : ajoute les PDF de cours pour profiter de cette aide.";
    setCache(questionId, 'course_refs', contentMd, { courseRefs: refs });
    return { contentMd, refs };
  });
}

// ---------- Vérification d'une réponse ----------

/** Réponse de l'étudiant telle qu'enregistrée (texte, code ou photo). */
export interface StudentAnswer {
  type: 'text' | 'code' | 'image';
  text?: string | null;
  code?: string | null;
  codeLang?: string | null;
  imagePath?: string | null;
}

/** Réponse de l'étudiant mise en forme pour l'IA (la photo est jointe en image). */
export async function answerBlocks(a: StudentAnswer, title = "### Réponse de l'étudiant"): Promise<ContentBlock[]> {
  if (a.type === 'image' && a.imagePath) {
    return [{ type: 'text', text: `${title} (photo de sa copie manuscrite)${a.text ? `\nCommentaire : ${a.text}` : ''}` }, await imageBlock(a.imagePath)];
  }
  if (a.type === 'code') {
    return [{ type: 'text', text: `${title} (code ${a.codeLang ?? ''})\n\`\`\`${a.codeLang ?? ''}\n${a.code ?? ''}\n\`\`\`` }];
  }
  return [{ type: 'text', text: `${title}\n${a.text ?? ''}` }];
}

/** Simulation : « faux » ou une réponse vide est incorrecte, « partiel » est partielle, le reste est juste. */
function mockVerify(a: StudentAnswer): VerifyResult {
  const raw = (a.text ?? a.code ?? '').trim();
  const lower = raw.toLowerCase();
  if (a.type !== 'image' && (raw.length < 2 || lower.includes('faux'))) {
    return {
      verdict: 'incorrect',
      errorLocation: raw.slice(0, Math.min(raw.length, 20)) || '(réponse vide)',
      errorExplanation: '**Explication (simulation)** : ce passage ne respecte pas la méthode du cours.',
    };
  }
  if (lower.includes('partiel')) {
    return { verdict: 'partiel', errorLocation: raw.slice(0, 15), errorExplanation: 'Il manque une justification (simulation).' };
  }
  return { verdict: 'correct', errorLocation: null, errorExplanation: null };
}

/**
 * Corrige une réponse par rapport à la solution de référence (générée au besoin).
 * L'emplacement et l'explication de l'erreur sont gardés secrets : le lecteur les dévoile pas à pas.
 */
export async function verifyAnswer(questionId: string, answer: StudentAnswer): Promise<VerifyResult> {
  const ctx = questionWithContext(questionId);
  const ref = await referenceSolution(questionId);
  const r = await runAgent({
    task: 'tutor.verify',
    kind: 'tutor',
    system: PROMPTS.verify,
    content: await questionContent(ctx, [`### Solution de référence${ref.source === 'official' ? ' (corrigé officiel)' : ''}\n${ref.contentMd}`], await answerBlocks(answer)),
    schema: VerifySchema,
    effort: 'high',
    mock: () => mockVerify(answer),
  });
  return r.data.verdict === 'correct' ? { verdict: 'correct', errorLocation: null, errorExplanation: null } : r.data;
}
