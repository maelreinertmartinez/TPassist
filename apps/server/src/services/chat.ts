import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { ChatMessageDto, ChatThreadDto } from '@tpassist/shared';
import { AiError, runAgent, type ContentBlock } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { courseToolsServer } from '../ai/tools/courseTools';
import { config } from '../config';
import { db, newId } from '../db/client';
import { HttpError, notFound, orderedQuestions, questionWithContext } from '../db/repo';
import { attempts, chatMessages, chatThreads, courses, sessionQuestions, sessions, units } from '../db/schema';
import { computeLocks } from './unlocks';
import { saveImage } from './sessions';
import { cachedSolution } from './tutor';
import { readFile } from 'node:fs/promises';

type ThreadRow = typeof chatThreads.$inferSelect;
type MessageRow = typeof chatMessages.$inferSelect;

function messageDto(m: MessageRow): ChatMessageDto {
  return { id: m.id, role: m.role, contentMd: m.contentMd, imageUrl: m.imagePath ? `/api/chat/messages/${m.id}/image` : null, createdAt: m.createdAt };
}

function threadDisabled(t: ThreadRow): boolean {
  if (t.scope !== 'session' || !t.sessionId) return false;
  const s = db.select({ mode: sessions.mode, status: sessions.status }).from(sessions).where(eq(sessions.id, t.sessionId)).get();
  return Boolean(s && s.mode === 'ei_examen' && s.status === 'in_progress');
}

export function getOrCreateThread(scope: 'course' | 'session', courseId: string, sessionId?: string): ThreadRow {
  const where =
    scope === 'session' && sessionId
      ? and(eq(chatThreads.scope, 'session'), eq(chatThreads.sessionId, sessionId))
      : and(eq(chatThreads.scope, 'course'), eq(chatThreads.courseId, courseId), isNull(chatThreads.sessionId));
  const existing = db.select().from(chatThreads).where(where).get();
  if (existing) return existing;
  return db
    .insert(chatThreads)
    .values({ id: newId(), scope, courseId, sessionId: scope === 'session' ? (sessionId ?? null) : null })
    .returning()
    .get();
}

export function getThread(threadId: string): ChatThreadDto {
  const t = db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).get() ?? notFound('Conversation');
  const msgs = db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).orderBy(asc(chatMessages.createdAt)).all();
  return { id: t.id, scope: t.scope, messages: msgs.map(messageDto), disabled: threadDisabled(t) };
}

interface ChatContext {
  prefix: string;
  questionId: string | null;
  unitId?: string;
  locked: { hint: boolean; solution: boolean };
}

function buildContext(t: ThreadRow): ChatContext {
  const course = db.select().from(courses).where(eq(courses.id, t.courseId)).get();
  if (t.scope !== 'session' || !t.sessionId) {
    return {
      prefix: `[Contexte]\nL'étudiant consulte la page du cours « ${course?.name ?? ''} ». Aucun exercice n'est en cours.\n[/Contexte]`,
      questionId: null,
      locked: { hint: false, solution: false },
    };
  }
  const s = db.select().from(sessions).where(eq(sessions.id, t.sessionId)).get() ?? notFound('Session');
  const unit = db.select().from(units).where(eq(units.id, s.unitId)).get();
  const lines = [`[Contexte]`, `Cours : ${course?.name ?? ''}`, `Sujet ouvert : ${unit?.title ?? ''} (${unit?.kind ?? ''})`];
  const sqs = db.select().from(sessionQuestions).where(eq(sessionQuestions.sessionId, s.id)).all();
  const rows = orderedQuestions(s.unitId);
  const doneLabels = rows.filter(({ q }) => sqs.find((x) => x.questionId === q.id)?.closed).map(({ q, ex }) => `${ex.title} ${q.label}`);
  if (doneLabels.length) lines.push(`Questions déjà terminées (tu peux les détailler) : ${doneLabels.join(', ')}`);

  let locked = { hint: false, solution: false };
  let questionId: string | null = null;
  if (s.status === 'in_progress' && s.currentQuestionId) {
    questionId = s.currentQuestionId;
    const sq = sqs.find((x) => x.questionId === questionId)!;
    const ctx = questionWithContext(questionId);
    const list = db.select().from(attempts).where(and(eq(attempts.sessionId, s.id), eq(attempts.questionId, questionId))).orderBy(asc(attempts.createdAt)).all();
    const locks = computeLocks({
      mode: s.mode,
      activeMs: sq.activeMs,
      delayMs: config.unlockDelayMs,
      closed: sq.closed,
      courseRefsAtMs: sq.courseRefsAtMs,
      hintAtMs: sq.hintAtMs,
      solutionUnlocked: sq.solutionUnlocked,
      attempts: list,
    });
    locked = { hint: !locks.hint.unlocked, solution: !locks.solution.unlocked };
    lines.push(
      `Question affichée : ${ctx.ex.title} — ${ctx.q.label}`,
      ctx.ex.contextMd ? `Énoncé commun : ${ctx.ex.contextMd}` : '',
      `Énoncé de la question : ${ctx.q.statementMd}`,
      `Indice de cette question : ${locked.hint ? 'VERROUILLÉ' : 'débloqué'} ; solution de cette question : ${locked.solution ? 'VERROUILLÉE' : 'débloquée'}.`,
    );
    if (!locked.solution) {
      const sol = cachedSolution(questionId)?.contentMd ?? ctx.q.officialSolutionMd;
      if (sol) lines.push(`Solution de référence (débloquée, tu peux l'expliquer) :\n${sol}`);
    }
  } else {
    lines.push('Le sujet est terminé : tu peux revenir librement sur toutes les questions.');
  }
  lines.push('[/Contexte]');
  return { prefix: lines.filter(Boolean).join('\n'), questionId, unitId: s.unitId, locked };
}

function mockReply(text: string, ctx: ChatContext): string {
  if (ctx.locked.solution && /solution|réponse|resultat|résultat/i.test(text)) {
    return "La solution de cette question n'est pas encore débloquée (simulation). En attendant, revois la partie de cours associée : je peux t'expliquer la notion utilisée.";
  }
  return `Réponse simulée à ta question : « ${text.slice(0, 120)} ». Pense à t'appuyer sur la définition vue en cours.`;
}

export async function sendMessage(threadId: string, body: { text: string; imageDataUrl?: string | null }, onText: (d: string) => void): Promise<ChatMessageDto> {
  const t = db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).get() ?? notFound('Conversation');
  if (threadDisabled(t)) throw new HttpError(403, 'Le chat est désactivé pendant une EI en mode examen.');
  const text = body.text?.trim();
  if (!text) throw new HttpError(400, 'Message vide.');

  const userMsgId = newId();
  const imagePath = body.imageDataUrl ? await saveImage(body.imageDataUrl, `chat-${userMsgId}`) : null;
  const ctx = buildContext(t);
  db.insert(chatMessages).values({ id: userMsgId, threadId, role: 'user', contentMd: text, imagePath, questionId: ctx.questionId }).run();

  const blocks: ContentBlock[] = [{ type: 'text', text: `${ctx.prefix}\n\n${text}` }];
  if (imagePath) {
    blocks.push({ type: 'image', mediaType: imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg', data: (await readFile(imagePath)).toString('base64') });
  }

  const run = (resume: string | undefined, content: ContentBlock[]) =>
    runAgent<string>({
      task: 'chat',
      kind: 'tutor',
      system: PROMPTS.chat,
      content,
      mcp: courseToolsServer({ courseId: t.courseId, unitId: ctx.unitId }),
      effort: 'medium',
      persist: true,
      resume,
      onText,
      mock: () => mockReply(text, ctx),
    });

  let result;
  try {
    result = await run(t.sdkSessionId ?? undefined, blocks);
  } catch (err) {
    const definitive = err instanceof AiError && /authentification|factur|refusé|introuvable|limite/i.test(err.message);
    if (!t.sdkSessionId || !(err instanceof AiError) || definitive) throw err;
    // Transcription introuvable (volume réinitialisé…) : on repart avec l'historique en texte.
    const history = db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(12)
      .all()
      .reverse()
      .filter((m) => m.id !== userMsgId)
      .map((m) => `${m.role === 'user' ? 'Étudiant' : 'Tuteur'} : ${m.contentMd}`)
      .join('\n\n');
    const withHistory: ContentBlock[] = [{ type: 'text', text: `Historique récent de la conversation :\n${history}\n\n---\n` }, ...blocks];
    result = await run(undefined, withHistory);
  }

  if (result.sessionId && result.sessionId !== t.sdkSessionId) {
    db.update(chatThreads).set({ sdkSessionId: result.sessionId }).where(eq(chatThreads.id, threadId)).run();
  }

  // Une question posée pendant une question en cours compte comme une (petite) difficulté.
  if (t.scope === 'session' && t.sessionId && ctx.questionId) {
    const sq = db
      .select()
      .from(sessionQuestions)
      .where(and(eq(sessionQuestions.sessionId, t.sessionId), eq(sessionQuestions.questionId, ctx.questionId)))
      .get();
    if (sq && !sq.closed) {
      db.update(sessionQuestions)
        .set({ flags: { ...sq.flags, chat: sq.flags.chat + 1 } })
        .where(and(eq(sessionQuestions.sessionId, t.sessionId), eq(sessionQuestions.questionId, ctx.questionId)))
        .run();
    }
  }

  const reply = db
    .insert(chatMessages)
    .values({ id: newId(), threadId, role: 'assistant', contentMd: result.text, questionId: ctx.questionId })
    .returning()
    .get();
  return messageDto(reply);
}

export function chatImagePath(messageId: string): string | null {
  return db.select({ p: chatMessages.imagePath }).from(chatMessages).where(eq(chatMessages.id, messageId)).get()?.p ?? null;
}
