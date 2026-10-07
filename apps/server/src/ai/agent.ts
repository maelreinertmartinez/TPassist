// Point d'entrée unique vers l'IA (Claude Agent SDK) : un appel = une requête, sans outils de fichiers ni
// de terminal, avec au besoin les outils de lecture du cours (MCP) et une sortie structurée validée par Zod.
// Chaque appel est journalisé (coût, jetons, durée) pour la page Statistiques. En mode simulation
// (TPASSIST_AI_MOCK=1), la fonction `mock` de l'appel répond à la place de l'IA.
import {
  query,
  type EffortLevel,
  type McpSdkServerConfigWithInstance,
  type Options,
  type SDKResultMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import pLimit from 'p-limit';
import { z } from 'zod';
import { config, modelFor, type TaskKind } from '../config';
import { db, newId } from '../db/client';
import { aiCalls } from '../db/schema';
import { errorText } from '../utils';

/** Types d'images acceptés par l'API. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/** Morceau du message envoyé à l'IA : texte ou image en base64. */
export type ContentBlock = { type: 'text'; text: string } | { type: 'image'; mediaType: ImageMediaType; data: string };

/** Paramètres d'un appel à l'IA. */
export interface RunAgentOptions<T> {
  /** Nom de la tâche (journal de consommation). */
  task: string;
  kind: TaskKind;
  system: string;
  content: string | ContentBlock[];
  /** Sortie structurée validée par Zod. Sans schéma, le résultat est le texte. */
  schema?: z.ZodType<T>;
  /** Serveur MCP local (outils de lecture du cours). */
  mcp?: McpSdkServerConfigWithInstance;
  effort?: EffortLevel;
  maxTurns?: number;
  /** Diffusion du texte au fil de l'eau. */
  onText?: (delta: string) => void;
  /** Conversation persistée (chat) : reprise d'une session SDK. */
  persist?: boolean;
  resume?: string;
  /** Valeur renvoyée en mode TPASSIST_AI_MOCK=1. */
  mock: () => T | Promise<T>;
}

/** Résultat d'un appel : données validées, texte final et session SDK (pour reprendre une conversation). */
export interface AgentResult<T> {
  data: T;
  text: string;
  sessionId: string | null;
  costUsd: number;
}

/** Échec d'un appel à l'IA : `message` est lisible par l'étudiant, `detail` garde l'erreur technique. */
export class AiError extends Error {
  constructor(
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

const limit = pLimit(config.aiConcurrency);

/**
 * Appelle l'IA (au plus TPASSIST_AI_CONCURRENCY appels simultanés).
 * @throws AiError si l'appel échoue ou si la sortie structurée est invalide
 */
export function runAgent<T = string>(opts: RunAgentOptions<T>): Promise<AgentResult<T>> {
  return limit(() => (config.aiMock ? runMock(opts) : runReal(opts)));
}

/** Schéma Zod converti en JSON Schema (draft 7), le format attendu par l'API. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
}

function buildPrompt(content: string | ContentBlock[]): string | AsyncIterable<SDKUserMessage> {
  if (typeof content === 'string') return content;
  const blocks = content.map((b) =>
    b.type === 'text'
      ? ({ type: 'text', text: b.text } as const)
      : ({ type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.data } } as const),
  );
  const message: SDKUserMessage = {
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: blocks },
  };
  return (async function* () {
    yield message;
  })();
}

async function runReal<T>(opts: RunAgentOptions<T>): Promise<AgentResult<T>> {
  const model = modelFor(opts.kind);
  const started = Date.now();
  // Sert à couper court aux erreurs définitives (identifiants invalides…) que le SDK réessaierait longtemps.
  const abort = new AbortController();

  const options: Options = {
    model,
    effort: opts.effort ?? 'medium',
    thinking: { type: 'adaptive' },
    systemPrompt: opts.system,
    tools: [],
    // Outils MCP du cours + outil interne de sortie structurée, pré-approuvés (mode dontAsk).
    allowedTools: [...(opts.mcp ? ['mcp__course__*'] : []), ...(opts.schema ? ['StructuredOutput'] : [])],
    mcpServers: opts.mcp ? { course: opts.mcp } : {},
    permissionMode: 'dontAsk',
    permissionPrompts: 'none',
    settingSources: [],
    strictMcpConfig: true,
    persistSession: opts.persist ?? false,
    resume: opts.resume,
    cwd: config.workspaceDir,
    env: {
      ...process.env,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'tpassist/0.1.0',
    },
    includePartialMessages: Boolean(opts.onText),
    maxTurns: opts.maxTurns ?? (opts.mcp ? 14 : 6),
    abortController: abort,
    stderr: (data) => {
      if (process.env.TPASSIST_DEBUG_AI === '1') process.stderr.write(`[claude] ${data}`);
    },
  };
  if (opts.schema) options.outputFormat = { type: 'json_schema', schema: toJsonSchema(opts.schema) };

  let sessionId: string | null = null;
  let result: SDKResultMessage | null = null;
  let streamed = '';
  let thrown: unknown = null;
  let fatal: string | null = null;

  try {
    for await (const m of query({ prompt: buildPrompt(opts.content), options })) {
      if (m.type === 'system' && m.subtype === 'init') {
        sessionId = m.session_id;
      } else if (m.type === 'system' && m.subtype === 'api_retry') {
        // Erreurs définitives : inutile de laisser Claude Code réessayer pendant des minutes.
        if (FATAL_API_ERRORS.has(m.error) || m.error_status === 401 || m.error_status === 403) {
          fatal = `${m.error} (HTTP ${m.error_status ?? '?'})`;
          abort.abort();
          break;
        }
      } else if (m.type === 'stream_event') {
        if (m.parent_tool_use_id) continue;
        const ev = m.event;
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          streamed += ev.delta.text;
          opts.onText?.(ev.delta.text);
        }
      } else if (m.type === 'result') {
        result = m;
        sessionId = m.session_id ?? sessionId;
      }
    }
  } catch (err) {
    thrown = err;
  }

  const durationMs = Date.now() - started;
  const costUsd = result?.total_cost_usd ?? 0;
  const usage = result?.usage;
  const logCall = (ok: boolean, error?: string) =>
    db
      .insert(aiCalls)
      .values({
        id: newId(),
        task: opts.task,
        model,
        ok,
        costUsd,
        inputTokens: (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
        outputTokens: usage?.output_tokens ?? 0,
        durationMs,
        error: error ?? null,
      })
      .run();

  if (fatal) {
    logCall(false, fatal);
    throw new AiError(humanizeError(fatal), fatal);
  }

  if (!result || result.subtype !== 'success' || result.is_error) {
    const detail =
      result && 'errors' in result && result.errors?.length
        ? result.errors.join(' | ')
        : result && result.subtype === 'success'
          ? result.result
          : thrown instanceof Error
            ? thrown.message
            : String(thrown ?? 'aucun résultat');
    logCall(false, detail);
    throw new AiError(humanizeError(detail), detail);
  }

  if (opts.schema) {
    // Repli : JSON présent dans le texte final si l'outil de sortie structurée n'a pas été utilisé.
    const raw = result.structured_output ?? extractJson(result.result || streamed);
    if (raw === undefined || raw === null) {
      logCall(false, 'structured_output manquant');
      throw new AiError("L'IA n'a pas renvoyé de réponse structurée.", result.result);
    }
    const parsed = opts.schema.safeParse(raw);
    if (!parsed.success) {
      logCall(false, parsed.error.message);
      throw new AiError("La réponse de l'IA ne respecte pas le format attendu.", parsed.error.message);
    }
    logCall(true);
    return { data: parsed.data, text: result.result, sessionId, costUsd };
  }

  logCall(true);
  const text = result.result || streamed;
  return { data: text as T, text, sessionId, costUsd };
}

/** Extrait le premier objet JSON d'un texte (bloc ```json``` ou accolades). */
export function extractJson(text: string | undefined): unknown {
  if (!text) return undefined;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const candidates = [fenced, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)].filter((c): c is string => Boolean(c && c.trim()));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // candidat suivant
    }
  }
  return undefined;
}

const FATAL_API_ERRORS = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'billing_error',
  'model_not_found',
  'invalid_request',
]);

function humanizeError(detail: string): string {
  const d = detail.toLowerCase();
  if (d.includes('invalid api key') || d.includes('authentication') || d.includes('not logged in') || d.includes('401')) {
    return "Authentification Claude invalide : vérifie ANTHROPIC_API_KEY ou CLAUDE_CODE_OAUTH_TOKEN dans le fichier .env.";
  }
  if (d.includes('billing') || d.includes('account_on_hold')) return 'Problème de facturation ou de compte Claude : vérifie ton compte Anthropic.';
  if (d.includes('model_not_found')) return `Modèle introuvable (${config.model}) : vérifie TPASSIST_MODEL dans le fichier .env.`;
  if (d.includes('oauth_org_not_allowed') || d.includes('verification_required') || d.includes('403')) {
    return "Accès refusé par l'API Claude (403) : vérifie que ton identifiant a accès au modèle choisi.";
  }
  if (d.includes('rate limit') || d.includes('429') || d.includes('usage limit')) {
    return 'Limite d’utilisation Claude atteinte, réessaie un peu plus tard.';
  }
  if (d.includes('overloaded') || d.includes('529')) return 'Les serveurs Claude sont surchargés, réessaie dans un instant.';
  if (d.includes('max_turns')) return "L'IA n'a pas terminé dans le nombre d'étapes autorisé.";
  return `Erreur de l'IA : ${detail.slice(0, 300)}`;
}

async function runMock<T>(opts: RunAgentOptions<T>): Promise<AgentResult<T>> {
  const started = Date.now();
  const data = await opts.mock();
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  if (opts.onText && typeof data === 'string') {
    // Simule une diffusion progressive.
    const chunks = data.match(/.{1,24}/gs) ?? [];
    for (const c of chunks) {
      opts.onText(c);
      await new Promise((r) => setTimeout(r, 8));
    }
  }
  db.insert(aiCalls)
    .values({ id: newId(), task: opts.task, model: 'mock', ok: true, durationMs: Date.now() - started })
    .run();
  return { data, text, sessionId: opts.resume ?? newId(), costUsd: 0 };
}

// ---------- Santé ----------

/** Identifiant Claude configuré dans l'environnement. */
export function authSource(): 'api_key' | 'oauth_token' | 'none' {
  if (process.env.ANTHROPIC_API_KEY) return 'api_key';
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return 'oauth_token';
  return 'none';
}

/** Teste la connexion à l'IA avec un appel minimal. */
export async function pingAi(): Promise<{ ok: boolean; message: string }> {
  if (config.aiMock) return { ok: true, message: 'Mode simulation (TPASSIST_AI_MOCK=1) : aucune requête réelle.' };
  if (authSource() === 'none') {
    return { ok: false, message: 'Aucun identifiant : renseigne ANTHROPIC_API_KEY ou CLAUDE_CODE_OAUTH_TOKEN dans .env.' };
  }
  try {
    const r = await runAgent<string>({
      task: 'health',
      kind: 'tutor',
      system: 'Réponds uniquement par le mot OK.',
      content: 'Test de connexion.',
      effort: 'low',
      maxTurns: 1,
      mock: () => 'OK',
    });
    return { ok: true, message: `Connexion OK (${r.text.trim().slice(0, 40)})` };
  } catch (err) {
    return { ok: false, message: errorText(err) };
  }
}
