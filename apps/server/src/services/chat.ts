// Chat « Poser une question » : une conversation par cours et une par séance, reprise via la session du SDK.
// Chaque message est précédé d'un bloc [Contexte] (question affichée, aides verrouillées) que l'IA doit respecter.
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { ChatMessageDto, ChatThreadDto } from '@tpassist/shared';
import { AiError, runAgent, type ContentBlock } from '../ai/agent';
import { PROMPTS } from '../ai/prompts';
import { courseToolsServer } from '../ai/tools/courseTools';
import { db, newId } from '../db/client';
import { findById, orderedQuestions, questionWithContext } from '../db/repo';
import { chatMessages, chatThreads, courses, sessionQuestions, sessions, units } from '../db/schema';
import { HttpError } from '../errors';
import { imageBlock, saveImage } from './images';
import { loadSq, questionLocks, updateSq } from './sessions';
import { cachedSolution } from './tutor';

type ThreadRow = typeof chatThreads.$inferSelect;
type MessageRow = typeof chatMessages.$inferSelect;

/** Nombre de messages renvoyés en texte quand la conversation du SDK est perdue. */
const HISTORY_FALLBACK_MESSAGES = 12;

function messageDto(m: MessageRow): ChatMessageDto {
  return { id: m.id, role: m.role, contentMd: m.contentMd, imageUrl: m.imagePath ? `/api/chat/messages/${m.id}/image` : null, createdAt: m.createdAt };
}

/** Le chat est coupé pendant une EI en mode examen. */
function threadDisabled(t: ThreadRow): boolean {
  if (t.scope !== 'session' || !t.sessionId) return false;
  const s = db.select({ mode: sessions.mode, status: sessions.status }).from(sessions).where(eq(sessions.id, t.sessionId)).get();
  return Boolean(s && s.mode === 'ei_examen' && s.status === 'in_progress');
}

function getOrCreateThread(scope: 'course' | 'session', courseId: string, sessionId?: string): ThreadRow {
  const where =
    scope === 'session' && sessionId
      ? and(eq(chatThreads.scope, 'session'), eq(chatThreads.sessionId, sessionId))
      : and(eq(chatThreads.scope, 'course'), eq(chatThreads.courseId, courseId), isNull(chatThreads.sessionId));
  return (
    db.select().from(chatThreads).where(where).get() ??
    db
      .insert(chatThreads)
      .values({ id: newId(), scope, courseId, sessionId: scope === 'session' ? (sessionId ?? null) : null })
      .returning()
      .get()
  );
}

function threadDto(t: ThreadRow): ChatThreadDto {
  const msgs = db.select().from(chatMessages).where(eq(chatMessages.threadId, t.id)).orderBy(asc(chatMessages.createdAt)).all();
  return { id: t.id, messages: msgs.map(messageDto), disabled: threadDisabled(t) };
}

/** Conversation de la page d'un cours (créée au premier accès). */
export function courseThread(courseId: string): ChatThreadDto {
  findById(courses, courseId, 'Cours');
  return threadDto(getOrCreateThread('course', courseId));
}

/** Conversation d'une séance (créée au premier accès). */
export function sessionThread(sessionId: string): ChatThreadDto {
  const s = findById(sessions, sessionId, 'Session');
  return threadDto(getOrCreateThread('session', s.courseId, s.id));
}

interface ChatContext {
  prefix: string;
  questionId: string | null;
  unitId?: string;
  locked: { hint: boolean; solution: boolean };
}

/** Bloc [Contexte] ajouté à chaque message : ce que voit l'étudiant et ce qu'il ne faut pas encore dévoiler. */
function buildContext(t: ThreadRow): ChatContext {
  const course = db.select().from(courses).where(eq(courses.id, t.courseId)).get();
  if (t.scope !== 'session' || !t.sessionId) {
    return {
      prefix: `[Contexte]\nL'étudiant consulte la page du cours « ${course?.name ?? ''} ». Aucun exercice n'est en cours.\n[/Contexte]`,
      questionId: null,
      locked: { hint: false, solution: false },
    };
  }
  const s = findById(sessions, t.sessionId, 'Session');
  const unit = db.select().from(units).where(eq(units.id, s.unitId)).get();
  const lines = [`[Contexte]`, `Cours : ${course?.name ?? ''}`, `Sujet ouvert : ${unit?.title ?? ''} (${unit?.kind ?? ''})`];
  const closed = new Set(
    db
      .select({ questionId: sessionQuestions.questionId })
      .from(sessionQuestions)
      .where(and(eq(sessionQuestions.sessionId, s.id), eq(sessionQuestions.closed, true)))
      .all()
      .map((x) => x.questionId),
  );
  const doneLabels = orderedQuestions(s.unitId)
    .filter(({ q }) => closed.has(q.id))
    .map(({ q, ex }) => `${ex.title} ${q.label}`);
  if (doneLabels.length) lines.push(`Questions déjà terminées (tu peux les détailler) : ${doneLabels.join(', ')}`);

  let locked = { hint: false, solution: false };
  let questionId: string | null = null;
  if (s.status === 'in_progress' && s.currentQuestionId) {
    questionId = s.currentQuestionId;
    const ctx = questionWithContext(questionId);
    const locks = questionLocks(s, loadSq(s.id, questionId));
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

/** Derniers messages en texte, pour repartir d'une conversation du SDK introuvable. */
function historyText(threadId: string, excludeId: string): string {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(HISTORY_FALLBACK_MESSAGES)
    .all()
    .reverse()
    .filter((m) => m.id !== excludeId)
    .map((m) => `${m.role === 'user' ? 'Étudiant' : 'Tuteur'} : ${m.contentMd}`)
    .join('\n\n');
}

/**
 * Envoie un message (avec une image éventuelle) et diffuse la réponse du tuteur au fil de l'eau.
 * Une question posée pendant une question en cours compte comme une petite difficulté sur celle-ci.
 * @throws HttpError 403 si le chat est désactivé (EI en mode examen), 400 si le message est vide
 */
export async function sendMessage(threadId: string, body: { text: string; imageDataUrl?: string | null }, onText: (d: string) => void): Promise<ChatMessageDto> {
  const t = findById(chatThreads, threadId, 'Conversation');
  if (threadDisabled(t)) throw new HttpError(403, 'Le chat est désactivé pendant une EI en mode examen.');
  const text = body.text?.trim();
  if (!text) throw new HttpError(400, 'Message vide.');

  const userMsgId = newId();
  const imagePath = body.imageDataUrl ? await saveImage(body.imageDataUrl, `chat-${userMsgId}`) : null;
  const ctx = buildContext(t);
  db.insert(chatMessages).values({ id: userMsgId, threadId, role: 'user', contentMd: text, imagePath, questionId: ctx.questionId }).run();

  const blocks: ContentBlock[] = [{ type: 'text', text: `${ctx.prefix}\n\n${text}` }];
  if (imagePath) blocks.push(await imageBlock(imagePath));

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
    result = await run(undefined, [{ type: 'text', text: `Historique récent de la conversation :\n${historyText(threadId, userMsgId)}\n\n---\n` }, ...blocks]);
  }

  if (result.sessionId && result.sessionId !== t.sdkSessionId) {
    db.update(chatThreads).set({ sdkSessionId: result.sessionId }).where(eq(chatThreads.id, threadId)).run();
  }

  if (t.scope === 'session' && t.sessionId && ctx.questionId) {
    const sq = loadSq(t.sessionId, ctx.questionId);
    if (!sq.closed) updateSq(t.sessionId, ctx.questionId, { flags: { ...sq.flags, chat: sq.flags.chat + 1 } });
  }

  const reply = db.insert(chatMessages).values({ id: newId(), threadId, role: 'assistant', contentMd: result.text, questionId: ctx.questionId }).returning().get();
  return messageDto(reply);
}

/** Chemin de l'image jointe à un message, s'il y en a une. */
export function chatImagePath(messageId: string): string | null {
  return db.select({ p: chatMessages.imagePath }).from(chatMessages).where(eq(chatMessages.id, messageId)).get()?.p ?? null;
}
