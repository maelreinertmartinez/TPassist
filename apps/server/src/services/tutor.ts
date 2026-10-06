import { and, asc, eq, lt } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import type { CourseRef } from '@tpassist/shared';
import { runAgent, type ContentBlock, type ImageMediaType } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { CourseRefsSchema, VerifySchema, type VerifyResult } from '../ai/schemas';
import { courseToolsServer } from '../ai/tools/courseTools';
import { db, ftsSearch } from '../db/client';
import { questionWithContext, type QuestionContext } from '../db/repo';
import { courseSections, questionAiCache, questions, units } from '../db/schema';
import { readPageBase64 } from '../pdf/render';

type CacheKind = 'reformulation' | 'course_refs' | 'hint' | 'solution';

export function getCache(questionId: string, kind: CacheKind) {
  return db
    .select()
    .from(questionAiCache)
    .where(and(eq(questionAiCache.questionId, questionId), eq(questionAiCache.kind, kind)))
    .get();
}

export function setCache(questionId: string, kind: CacheKind, contentMd: string, data?: { courseRefs?: CourseRef[]; source?: 'official' | 'ai' }) {
  db.insert(questionAiCache)
    .values({ questionId, kind, contentMd, data: data ?? null })
    .onConflictDoUpdate({ target: [questionAiCache.questionId, questionAiCache.kind], set: { contentMd, data: data ?? null, createdAt: Date.now() } })
    .run();
}

const inflight = new Map<string, Promise<unknown>>();
/** Une seule génération à la fois par clé : les appels simultanés partagent le même résultat. */
export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cur = inflight.get(key) as Promise<T> | undefined;
  if (cur) return cur;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Énoncé de la question (avec contexte et questions précédentes si nécessaire). */
export function questionText(ctx: QuestionContext): string {
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

export async function questionContent(ctx: QuestionContext, extra: string[] = [], extraBlocks: ContentBlock[] = []): Promise<ContentBlock[]> {
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

// ---------- Reformulation ----------

export async function reformulate(questionId: string, onText?: (d: string) => void, signal?: AbortSignal) {
  const cached = getCache(questionId, 'reformulation');
  if (cached) return { contentMd: cached.contentMd, cached: true };
  return dedupe(`${questionId}:reformulation`, async () => {
    const ctx = questionWithContext(questionId);
    const r = await runAgent<string>({
      task: 'tutor.reformulation',
      kind: 'tutor',
      system: PROMPTS.reformulation,
      content: await questionContent(ctx),
      effort: 'low',
      onText,
      signal,
      mock: () => `**Reformulation (simulation)** — On te demande de traiter la question ${ctx.q.label} :\n\n> ${ctx.q.statementMd.slice(0, 300)}\n\n**Ce qu'on te demande :** comprendre et résoudre cette question avec les données de l'exercice.`,
    });
    setCache(questionId, 'reformulation', r.text);
    return { contentMd: r.text, cached: false };
  });
}

// ---------- Partie de cours ----------

function enrichRefs(refs: { sectionId: string; why: string; excerptMd: string }[], courseId: string): CourseRef[] {
  const out: CourseRef[] = [];
  for (const r of refs) {
    const s = db
      .select({ s: courseSections, unitTitle: units.title, documentId: units.documentId })
      .from(courseSections)
      .innerJoin(units, eq(units.id, courseSections.unitId))
      .where(and(eq(courseSections.id, r.sectionId), eq(courseSections.courseId, courseId)))
      .get();
    if (!s) continue;
    out.push({
      sectionId: r.sectionId,
      title: s.s.title,
      unitTitle: s.unitTitle,
      pageStart: s.s.pageStart,
      pageEnd: s.s.pageEnd,
      documentId: s.documentId,
      why: r.why,
      excerptMd: r.excerptMd,
    });
  }
  return out;
}

export async function courseRefs(questionId: string, signal?: AbortSignal) {
  const cached = getCache(questionId, 'course_refs');
  if (cached) return { contentMd: cached.contentMd, refs: cached.data?.courseRefs ?? [], cached: true };
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
        signal,
        mock: () => {
          const hits = ftsSearch(courseId, `${ctx.q.statementMd} ${ctx.ex.contextMd}`, 2);
          const ids = hits.length
            ? hits.map((h) => h.sectionId)
            : db.select({ id: courseSections.id }).from(courseSections).where(eq(courseSections.courseId, courseId)).limit(2).all().map((s) => s.id);
          return { refs: ids.map((id) => ({ sectionId: id, why: 'Cette partie présente la notion utilisée dans la question (simulation).', excerptMd: hits.find((h) => h.sectionId === id)?.snippet ?? 'Extrait du cours (simulation).' })) };
        },
      });
      refs = enrichRefs(r.data.refs, courseId);
    }
    const contentMd = refs.length
      ? ''
      : hasSections
        ? "Aucune partie du cours importé ne semble directement liée à cette question."
        : "Aucun cours n'a encore été importé pour ce module : ajoute les PDF de cours pour profiter de cette aide.";
    setCache(questionId, 'course_refs', contentMd, { courseRefs: refs });
    return { contentMd, refs, cached: false };
  });
}

// ---------- Solution de référence ----------

export interface ReferenceSolution {
  contentMd: string;
  source: 'official' | 'ai';
}

export function cachedSolution(questionId: string): ReferenceSolution | null {
  const c = getCache(questionId, 'solution');
  return c ? { contentMd: c.contentMd, source: c.data?.source ?? 'ai' } : null;
}

export async function referenceSolution(questionId: string, onText?: (d: string) => void, signal?: AbortSignal): Promise<ReferenceSolution & { cached: boolean }> {
  const cached = cachedSolution(questionId);
  if (cached) return { ...cached, cached: true };
  return dedupe(`${questionId}:solution`, async () => {
    const ctx = questionWithContext(questionId);
    const official = ctx.q.officialSolutionMd?.trim();
    const extra = official ? [`### Corrigé officiel (à suivre fidèlement)\n${official}`] : [];
    const r = await runAgent<string>({
      task: 'tutor.solution',
      kind: 'tutor',
      system: PROMPTS.solution,
      content: await questionContent(ctx, extra),
      effort: 'high',
      onText,
      signal,
      mock: () =>
        official
          ? `${official}\n\n**Explications (simulation)** : chaque étape du corrigé officiel applique la méthode du cours.\n\n**À retenir** : relire la définition utilisée.`
          : `**Solution (simulation)** pour la question ${ctx.q.label}.\n\n1. On identifie les données.\n2. On applique la méthode du cours.\n3. On conclut : **résultat attendu**.\n\n**À retenir** : vérifier chaque étape.`,
    });
    const source = official ? 'official' : 'ai';
    setCache(questionId, 'solution', r.text, { source });
    return { contentMd: r.text, source, cached: false };
  });
}

// ---------- Indice ----------

export async function hint(questionId: string, onText?: (d: string) => void, signal?: AbortSignal) {
  const cached = getCache(questionId, 'hint');
  if (cached) return { contentMd: cached.contentMd, cached: true };
  return dedupe(`${questionId}:hint`, async () => {
    const ctx = questionWithContext(questionId);
    const ref = cachedSolution(questionId)?.contentMd ?? ctx.q.officialSolutionMd ?? null;
    const extra = ref ? [`### Solution de référence (pour orienter l'indication, NE PAS la recopier)\n${ref}`] : [];
    const r = await runAgent<string>({
      task: 'tutor.hint',
      kind: 'tutor',
      system: PROMPTS.hint,
      content: await questionContent(ctx, extra),
      effort: 'medium',
      onText,
      signal,
      mock: () => `**Indice (simulation)** : repars de la définition vue en cours et applique-la aux données de l'énoncé de la question ${ctx.q.label}.`,
    });
    setCache(questionId, 'hint', r.text);
    return { contentMd: r.text, cached: false };
  });
}

// ---------- Vérification ----------

export interface StudentAnswer {
  type: 'text' | 'code' | 'image';
  text?: string | null;
  code?: string | null;
  codeLang?: string | null;
  imagePath?: string | null;
}

export async function answerBlocks(a: StudentAnswer, title = "### Réponse de l'étudiant"): Promise<ContentBlock[]> {
  if (a.type === 'image' && a.imagePath) {
    const data = (await readFile(a.imagePath)).toString('base64');
    const mediaType: ImageMediaType = a.imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return [
      { type: 'text', text: `${title} (photo de sa copie manuscrite)${a.text ? `\nCommentaire : ${a.text}` : ''}` },
      { type: 'image', mediaType, data },
    ];
  }
  if (a.type === 'code') {
    return [{ type: 'text', text: `${title} (code ${a.codeLang ?? ''})\n\`\`\`${a.codeLang ?? ''}\n${a.code ?? ''}\n\`\`\`` }];
  }
  return [{ type: 'text', text: `${title}\n${a.text ?? ''}` }];
}

function mockVerify(a: StudentAnswer): VerifyResult {
  const raw = (a.text ?? a.code ?? '').trim();
  const lower = raw.toLowerCase();
  if (a.type !== 'image' && (raw.length < 2 || lower.includes('faux'))) {
    return {
      verdict: 'incorrect',
      errorLocation: raw.slice(0, Math.min(raw.length, 20)) || '(réponse vide)',
      errorExplanation: "**Explication (simulation)** : ce passage ne respecte pas la méthode du cours.",
    };
  }
  if (lower.includes('partiel')) {
    return { verdict: 'partiel', errorLocation: raw.slice(0, 15), errorExplanation: 'Il manque une justification (simulation).' };
  }
  return { verdict: 'correct', errorLocation: null, errorExplanation: null };
}

export async function verifyAnswer(questionId: string, answer: StudentAnswer, signal?: AbortSignal): Promise<VerifyResult> {
  const ctx = questionWithContext(questionId);
  const ref = await referenceSolution(questionId, undefined, signal);
  const r = await runAgent({
    task: 'tutor.verify',
    kind: 'tutor',
    system: PROMPTS.verify,
    content: await questionContent(ctx, [`### Solution de référence${ref.source === 'official' ? ' (corrigé officiel)' : ''}\n${ref.contentMd}`], await answerBlocks(answer)),
    schema: VerifySchema,
    effort: 'high',
    signal,
    mock: () => mockVerify(answer),
  });
  const v = r.data;
  if (v.verdict === 'correct') return { verdict: 'correct', errorLocation: null, errorExplanation: null };
  return v;
}
