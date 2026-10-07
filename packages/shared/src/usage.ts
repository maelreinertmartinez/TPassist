// Santé de la connexion à l'IA et statistiques de consommation.

export interface AiHealth {
  ok: boolean;
  /** Mode simulation (TPASSIST_AI_MOCK=1) : aucune requête réelle. */
  mock: boolean;
  model: string;
  authSource: 'api_key' | 'oauth_token' | 'none';
  message: string;
  /** Date du test (le serveur garde le résultat 10 min). */
  checkedAt: number;
}

/** Totaux de consommation de l’IA. */
export interface UsageTotals {
  calls: number;
  errors: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

/** Consommation d’un jour. */
export interface UsageDay extends Omit<UsageTotals, 'durationMs'> {
  /** Jour local au format AAAA-MM-JJ. */
  day: string;
}

/** Consommation d’une tâche IA. */
export interface UsageTask extends UsageTotals {
  task: string;
}

/** Statistiques de la page Statistiques. */
export interface AiUsageStats {
  /** Début de la période (ms) ; 0 = depuis toujours. */
  from: number;
  totals: UsageTotals;
  allTime: { calls: number; costUsd: number; firstCallAt: number | null };
  byDay: UsageDay[];
  byTask: UsageTask[];
  byModel: { model: string; calls: number; costUsd: number }[];
  recentErrors: { id: string; task: string; model: string; error: string; createdAt: number }[];
}

/** Grande famille d’usage de l’IA. */
export type UsageCategory = 'ingest' | 'help' | 'verify' | 'chat' | 'report' | 'quiz' | 'ei' | 'notions' | 'other';

/** Libellé de chaque famille d’usage. */
export const USAGE_CATEGORY_LABELS: Record<UsageCategory, string> = {
  ingest: 'Analyse des PDF',
  help: 'Aides (cours, indication, solution…)',
  verify: 'Vérification des réponses',
  chat: 'Chat',
  report: 'Bilans de séance',
  quiz: 'Quiz',
  ei: 'EI blanches générées',
  notions: 'Carte et fiches des notions',
  other: 'Tests de connexion et divers',
};

/** Libellé lisible de chaque tâche IA (le nom technique est enregistré à chaque appel). */
const TASK_LABELS: Record<string, string> = {
  'ingest.segment': 'Découpage des PDF en parties',
  'ingest.cours': 'Transcription des chapitres de cours',
  'ingest.td': 'Extraction des TD',
  'ingest.tp': 'Extraction des TP',
  'ingest.ei': 'Extraction des EI',
  'ingest.corrige': 'Extraction des corrigés',
  'ingest.link_corrections': 'Rattachement des corrigés',
  'tutor.reformulation': 'Reformulation d’énoncé',
  'tutor.course_refs': 'Recherche de la partie de cours',
  'tutor.hint': 'Indication',
  'tutor.solution': 'Solution expliquée',
  'tutor.verify': 'Vérification d’une réponse',
  chat: 'Question au chat',
  'report.exercise': 'Bilan d’un exercice',
  'report.summary': 'Synthèse et points bloquants',
  'quiz.tp_review': 'Génération de quiz de révision',
  'quiz.course_full': 'Génération de quiz complet',
  'quiz.grade_open': 'Correction de question ouverte',
  'ei.generate': 'Génération d’EI blanche',
  'notions.map': 'Carte des notions',
  'notions.detail': 'Fiche d’une notion',
  health: 'Test de connexion',
};

/** Tâches classées à part de leur famille (une correction compte comme une vérification). */
const CATEGORY_BY_TASK: Record<string, UsageCategory> = {
  'tutor.verify': 'verify',
  'quiz.grade_open': 'verify',
  chat: 'chat',
};

/** Catégorie selon la famille de la tâche (préfixe avant le point). */
const CATEGORY_BY_FAMILY: Record<string, UsageCategory> = {
  ingest: 'ingest',
  tutor: 'help',
  report: 'report',
  quiz: 'quiz',
  ei: 'ei',
  notions: 'notions',
};

/** Libellé lisible d'une tâche IA (le nom technique s'il est inconnu). */
export function taskLabel(task: string): string {
  return TASK_LABELS[task] ?? task;
}

/** Catégorie d'usage d'une tâche IA, pour la répartition de la page Statistiques. */
export function taskCategory(task: string): UsageCategory {
  return CATEGORY_BY_TASK[task] ?? CATEGORY_BY_FAMILY[task.split('.')[0]] ?? 'other';
}
