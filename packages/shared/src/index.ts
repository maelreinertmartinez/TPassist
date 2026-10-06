// Types partagés entre l'API (apps/server) et le front (apps/web).

export * from './steps';

export type UnitKind = 'cours' | 'td' | 'tp' | 'ei' | 'corrige';
export type PlayableKind = 'td' | 'tp' | 'ei';
export type SessionMode = 'tp' | 'ei_aides' | 'ei_examen';
export type SessionStatus = 'in_progress' | 'reporting' | 'done';
export type QuestionStatus = 'unseen' | 'seen' | 'correct' | 'wrong' | 'skipped';
export type Verdict = 'correct' | 'incorrect' | 'partiel' | 'pending';
export type HelpKind = 'reformulation' | 'course_refs' | 'hint' | 'solution';
export type EventKind = HelpKind | 'error_location' | 'error_explanation';
export type AnswerType = 'text' | 'code' | 'image';
export type JobType = 'ingest' | 'link_corrections' | 'report' | 'quiz' | 'generate_ei' | 'notions';
export type JobStatus = 'queued' | 'running' | 'done' | 'error';
export type QuizKind = 'tp_review' | 'course_full';
export type QuizItemType = 'mcq' | 'open';
export type WeakPointStatus = 'active' | 'mastered' | 'resolved';
export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'error';

export const UNIT_KIND_LABELS: Record<UnitKind, string> = {
  cours: 'Cours',
  td: 'TD',
  tp: 'TP',
  ei: 'EI',
  corrige: 'Corrigé',
};

export const SESSION_MODE_LABELS: Record<SessionMode, string> = {
  tp: 'Entraînement',
  ei_aides: 'EI avec aides',
  ei_examen: 'EI sans aide (examen)',
};

export const CODE_LANGUAGES = ['python', 'c', 'cpp', 'java', 'javascript', 'sql', 'autre'] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export interface QuestionFlags {
  reformulate: boolean;
  courseRefs: boolean;
  hint: boolean;
  solution: boolean;
  selfStruggle: boolean;
  wrongAttempts: number;
  chat: number;
}

export const EMPTY_FLAGS: QuestionFlags = {
  reformulate: false,
  courseRefs: false,
  hint: false,
  solution: false,
  selfStruggle: false,
  wrongAttempts: 0,
  chat: 0,
};

// ---------- Cours / documents / unités ----------

export interface CourseSummary {
  id: string;
  name: string;
  color: string;
  icon: string;
  createdAt: number;
  counts: { cours: number; td: number; tp: number; ei: number };
  inProgressSessions: number;
  activeWeakPoints: number;
}

export interface DocumentDto {
  id: string;
  filename: string;
  pageCount: number | null;
  status: DocumentStatus;
  error: string | null;
  createdAt: number;
}

export interface CorrigeSolution {
  exerciseLabel: string;
  questionLabel: string;
  solutionMd: string;
  pageStart: number | null;
  pageEnd: number | null;
  matchedQuestionId?: string | null;
}

export interface UnitMeta {
  durationMinutes?: number | null;
  difficulty?: string | null;
  /** Pour un corrigé : solutions extraites, avec leur rattachement éventuel. */
  solutions?: CorrigeSolution[];
  targetTitle?: string | null;
  /** Pour une EI générée : options de génération. */
  generation?: { difficulty: string; sectionIds: string[]; basedOn: string[] };
}

export interface UnitDto {
  id: string;
  courseId: string;
  kind: UnitKind;
  title: string;
  order: number;
  documentId: string | null;
  documentName: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  origin: 'imported' | 'generated';
  correctsUnitId: string | null;
  hasCorrection: boolean;
  questionCount: number;
  sectionCount: number;
  meta: UnitMeta;
}

export interface SectionDto {
  id: string;
  unitId: string;
  title: string;
  pageStart: number | null;
  pageEnd: number | null;
  summary: string;
  keyConcepts: string[];
}

export interface JobDto {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  message: string | null;
  error: string | null;
  refId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SessionSummary {
  id: string;
  unitId: string;
  unitTitle: string;
  unitKind: UnitKind;
  mode: SessionMode;
  status: SessionStatus;
  progress: { done: number; total: number };
  score: number | null;
  reportId: string | null;
  reviewQuizId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface QuizSummary {
  id: string;
  kind: QuizKind;
  title: string;
  status: QuizStatus;
  score: number | null;
  total: number;
  createdAt: number;
}

export type QuizStatus = 'generating' | 'ready' | 'done' | 'error';

export interface WeakPointDto {
  id: string;
  notion: string;
  descriptionMd: string;
  priority: number;
  status: WeakPointStatus;
  successStreak: number;
  sections: { id: string; title: string }[];
  sourceQuestions: { id: string; label: string; unitTitle: string }[];
  updatedAt: number;
}

export interface CourseDetail {
  course: { id: string; name: string; color: string; icon: string; createdAt: number };
  documents: DocumentDto[];
  units: UnitDto[];
  sections: SectionDto[];
  jobs: JobDto[];
  sessions: SessionSummary[];
  quizzes: QuizSummary[];
  weakPoints: WeakPointDto[];
  /** Nombre de notions de la carte du cours (0 tant qu'elle n'a pas été générée). */
  notionCount: number;
}

// ---------- Carte des notions ----------

export type NotionKind = 'concept' | 'definition' | 'theoreme' | 'propriete' | 'methode' | 'formule';

export const NOTION_KIND_LABELS: Record<NotionKind, string> = {
  concept: 'Notion',
  definition: 'Définition',
  theoreme: 'Théorème',
  propriete: 'Propriété',
  methode: 'Méthode',
  formule: 'Formule',
};

export interface NotionDto {
  id: string;
  /** Chapitre (unité de cours) auquel la notion appartient. */
  unitId: string;
  /** Notion principale dont elle est une sous-notion (un seul niveau). */
  parentId: string | null;
  order: number;
  title: string;
  summary: string;
  kind: NotionKind;
  sectionIds: string[];
  prerequisiteIds: string[];
  /** Points bloquants actifs liés à cette notion. */
  weakPointIds: string[];
  hasDetail: boolean;
}

export interface NotionMapDto {
  notions: NotionDto[];
  /** Dernière génération demandée (en cours, terminée ou en échec). */
  job: JobDto | null;
  /** Les chapitres ont changé depuis la génération de la carte. */
  stale: boolean;
  generatedAt: number | null;
}

export interface NotionDetailDto {
  id: string;
  detailMd: string | null;
  sections: { id: string; title: string; unitTitle: string; pageStart: number | null; pageEnd: number | null; contentMd: string }[];
}

// ---------- Éditeur de structure ----------

export interface EditorQuestion {
  id: string;
  order: number;
  label: string;
  statementMd: string;
  figurePages: number[];
  points: number | null;
  dependsOnPrevious: boolean;
  officialSolutionMd: string | null;
}

export interface EditorExercise {
  id: string;
  order: number;
  title: string;
  contextMd: string;
  questions: EditorQuestion[];
}

export interface EditorSection extends SectionDto {
  contentMd: string;
}

export interface EditorUnit {
  unit: UnitDto;
  exercises: EditorExercise[];
  sections: EditorSection[];
  /** Unités du même cours (pour fusion / rattachement de corrigé). */
  siblings: { id: string; kind: UnitKind; title: string; documentId: string | null }[];
}

// ---------- Session (lecteur de TP/TD/EI) ----------

export interface LockInfo {
  unlocked: boolean;
  /** Temps actif restant avant déblocage ; null si un prérequis manque. */
  remainingMs: number | null;
  /** Message explicatif quand un prérequis manque. */
  reason?: string;
}

export interface LocksDto {
  activeMs: number;
  delayMs: number;
  hint: LockInfo;
  solution: LockInfo;
  /** Chaîne « erreur » de la dernière tentative fausse (null s'il n'y en a pas). */
  error: null | {
    attemptId: string;
    showError: LockInfo;
    explainError: LockInfo;
    solution: LockInfo;
  };
}

export interface FigureRef {
  page: number;
  url: string;
}

export interface QuestionView {
  id: string;
  label: string;
  exerciseTitle: string;
  contextMd: string;
  statementMd: string;
  figures: FigureRef[];
  dependsOnPrevious: boolean;
  points: number | null;
  hasOfficialSolution: boolean;
}

export interface CourseRef {
  sectionId: string;
  title: string;
  unitTitle: string;
  pageStart: number | null;
  pageEnd: number | null;
  documentId: string | null;
  why: string;
  excerptMd: string;
}

export interface HelpEventDto {
  id: string;
  kind: EventKind;
  contentMd: string;
  courseRefs?: CourseRef[];
  solutionSource?: 'official' | 'ai';
  attemptId?: string | null;
  createdAt: number;
}

export interface AttemptDto {
  id: string;
  type: AnswerType;
  text: string | null;
  code: string | null;
  codeLang: string | null;
  imageUrl: string | null;
  verdict: Verdict;
  revealed: { location?: string; explanation?: string };
  createdAt: number;
}

export interface CurrentQuestionState {
  question: QuestionView;
  status: QuestionStatus;
  /** Question fermée : on affiche la solution de transition avant de continuer. */
  closed: boolean;
  flags: QuestionFlags;
  events: HelpEventDto[];
  attempts: AttemptDto[];
  locks: LocksDto;
}

export interface OutlineItem {
  id: string;
  label: string;
  exerciseTitle: string;
  status: QuestionStatus;
  answered: boolean;
}

export interface SessionState {
  session: {
    id: string;
    courseId: string;
    courseName: string;
    unitId: string;
    unitTitle: string;
    unitKind: UnitKind;
    mode: SessionMode;
    status: SessionStatus;
    timeLimitSec: number | null;
    elapsedSec: number;
    score: number | null;
    reportId: string | null;
    reviewQuizId: string | null;
    chatThreadId: string | null;
  };
  outline: OutlineItem[];
  currentQuestionId: string | null;
  current: CurrentQuestionState | null;
}

export interface HeartbeatResponse {
  locks: LocksDto | null;
  elapsedSec: number;
  timeUp: boolean;
  status: SessionStatus;
}

export interface SubmitAttemptBody {
  questionId: string;
  type: AnswerType;
  text?: string;
  code?: string;
  codeLang?: string;
  /** Image en data URL (jpeg/png). */
  imageDataUrl?: string;
}

export interface SubmitAttemptResponse {
  attempt: AttemptDto;
  locks: LocksDto;
  status: QuestionStatus;
}

// ---------- Bilan ----------

export interface ReportAttempt {
  type: AnswerType;
  text: string | null;
  code: string | null;
  codeLang: string | null;
  imageUrl: string | null;
  verdict: Verdict;
  errorLocation: string | null;
  errorExplanation: string | null;
}

export interface ReportQuestion {
  questionId: string;
  label: string;
  exerciseTitle: string;
  contextMd: string;
  statementMd: string;
  status: QuestionStatus;
  attempts: ReportAttempt[];
  helps: string[];
  activeMs: number;
  explanationMd: string;
  solutionMd: string;
  solutionSource: 'official' | 'ai';
  score: number | null;
  maxScore: number | null;
}

export interface ReportDto {
  id: string;
  sessionId: string;
  status: 'pending' | 'ready' | 'error';
  error: string | null;
  courseId: string;
  unitTitle: string;
  unitKind: UnitKind;
  mode: SessionMode;
  score: number | null;
  createdAt: number;
  strengthsMd: string;
  overallMd: string;
  blockingPoints: { weakPointId: string | null; notion: string; descriptionMd: string }[];
  questions: ReportQuestion[];
  reviewQuiz: { proposedSize: number; noStruggle: boolean; quizId: string | null };
}

// ---------- Quiz ----------

export interface QuizItemDto {
  id: string;
  order: number;
  type: QuizItemType;
  promptMd: string;
  choices: string[];
  answered: boolean;
  userChoice: number | null;
  userAnswer: string | null;
  correct: boolean | null;
  /** Révélés seulement une fois l'item répondu. */
  correctIndex: number | null;
  expectedAnswerMd: string | null;
  explanationMd: string | null;
  feedbackMd: string | null;
  weakPointNotion: string | null;
}

export interface QuizDto {
  id: string;
  courseId: string;
  kind: QuizKind;
  title: string;
  status: QuizStatus;
  error: string | null;
  score: number | null;
  total: number;
  items: QuizItemDto[];
  createdAt: number;
}

// ---------- Chat ----------

export interface ChatMessageDto {
  id: string;
  role: 'user' | 'assistant';
  contentMd: string;
  imageUrl: string | null;
  createdAt: number;
}

export interface ChatThreadDto {
  id: string;
  scope: 'course' | 'session';
  messages: ChatMessageDto[];
  disabled: boolean;
}

// ---------- Divers ----------

export interface AiHealth {
  ok: boolean;
  mock: boolean;
  model: string;
  authSource: 'api_key' | 'oauth_token' | 'none';
  message: string;
  checkedAt: number;
}

// ---------- Statistiques d'utilisation de l'IA ----------

export interface UsageTotals {
  calls: number;
  errors: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface UsageDay extends Omit<UsageTotals, 'durationMs'> {
  /** Jour local au format AAAA-MM-JJ. */
  day: string;
}

export interface UsageTask extends UsageTotals {
  task: string;
}

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

export type UsageCategory = 'ingest' | 'help' | 'verify' | 'chat' | 'report' | 'quiz' | 'ei' | 'notions' | 'other';

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

export function taskLabel(task: string): string {
  return TASK_LABELS[task] ?? task;
}

export function taskCategory(task: string): UsageCategory {
  if (task.startsWith('ingest.')) return 'ingest';
  if (task === 'tutor.verify') return 'verify';
  if (task.startsWith('tutor.')) return 'help';
  if (task === 'chat') return 'chat';
  if (task.startsWith('report.')) return 'report';
  if (task === 'quiz.grade_open') return 'verify';
  if (task.startsWith('quiz.')) return 'quiz';
  if (task.startsWith('ei.')) return 'ei';
  if (task.startsWith('notions.')) return 'notions';
  return 'other';
}
