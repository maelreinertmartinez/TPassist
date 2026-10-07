// Séances de TD/TP/EI : questions, aides, tentatives, verrous temporels et état du lecteur.
import type { UnitKind } from './courses';

/** `tp` : entraînement (TD/TP) ; `ei_aides` / `ei_examen` : EI avec ou sans aides. */
export type SessionMode = 'tp' | 'ei_aides' | 'ei_examen';
/** `reporting` : séance terminée, bilan en préparation. */
export type SessionStatus = 'in_progress' | 'reporting' | 'done';
/** Statut d’une question dans une séance. */
export type QuestionStatus = 'unseen' | 'seen' | 'correct' | 'wrong' | 'skipped';
/** `pending` : réponse non corrigée (EI en mode examen, corrigée dans le bilan). */
export type Verdict = 'correct' | 'incorrect' | 'partiel' | 'pending';
/** Aides du tuteur sur une question. */
export type HelpKind = 'reformulation' | 'course_refs' | 'hint' | 'solution';
/** Ce qui peut être affiché sur une question : une aide ou un détail d’erreur. */
export type EventKind = HelpKind | 'error_location' | 'error_explanation';
/** Forme d’une réponse. */
export type AnswerType = 'text' | 'code' | 'image';
/** Origine d'une solution : corrigé officiel du professeur ou rédaction de l'IA. */
export type SolutionSource = 'official' | 'ai';

/** Toutes les aides du tuteur. */
export const HELP_KINDS: readonly HelpKind[] = ['reformulation', 'course_refs', 'hint', 'solution'];

/** Libellé de chaque mode de séance. */
export const SESSION_MODE_LABELS: Record<SessionMode, string> = {
  tp: 'Entraînement',
  ei_aides: 'EI avec aides',
  ei_examen: 'EI sans aide (examen)',
};

/** Langages proposés pour une réponse en code. */
export const CODE_LANGUAGES = ['python', 'c', 'cpp', 'java', 'javascript', 'sql', 'autre'] as const;
/** Langage d’une réponse en code. */
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/** Ce que l'étudiant a utilisé ou signalé sur une question : sert à mesurer la difficulté. */
export interface QuestionFlags {
  reformulate: boolean;
  courseRefs: boolean;
  hint: boolean;
  solution: boolean;
  /** « J'ai galéré » déclaré en passant la question sans réponse. */
  selfStruggle: boolean;
  wrongAttempts: number;
  /** Questions posées au chat pendant la question. */
  chat: number;
}

/** Aucune aide ni difficulté (début de question). */
export const EMPTY_FLAGS: QuestionFlags = {
  reformulate: false,
  courseRefs: false,
  hint: false,
  solution: false,
  selfStruggle: false,
  wrongAttempts: 0,
  chat: 0,
};

/** Résumé d'une séance dans l'historique du cours. */
export interface SessionSummary {
  id: string;
  unitId: string;
  unitTitle: string;
  unitKind: UnitKind;
  mode: SessionMode;
  status: SessionStatus;
  progress: { done: number; total: number };
  /** Note sur 20 (EI uniquement). */
  score: number | null;
  reportId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** État d’un verrou d’aide. */
export interface LockInfo {
  unlocked: boolean;
  /** Temps actif restant avant déblocage ; null si un prérequis manque. */
  remainingMs: number | null;
  /** Message explicatif quand un prérequis manque. */
  reason?: string;
}

/** Verrous des aides d'une question, calculés sur le temps actif passé dessus. */
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

/** Page du PDF montrée comme figure de l'énoncé. */
export interface FigureRef {
  page: number;
  url: string;
}

/** Énoncé d'une question tel que l'affiche le lecteur. */
export interface QuestionView {
  id: string;
  label: string;
  exerciseTitle: string;
  /** Énoncé commun de l'exercice (données, valeurs…). */
  contextMd: string;
  statementMd: string;
  figures: FigureRef[];
  /** Points du barème, s'ils sont indiqués. */
  points: number | null;
}

/** Partie du cours utile pour une question. */
export interface CourseRef {
  sectionId: string;
  title: string;
  unitTitle: string;
  pageStart: number | null;
  pageEnd: number | null;
  documentId: string | null;
  /** Pourquoi cette partie aide, sans résoudre la question. */
  why: string;
  excerptMd: string;
}

/** Aide obtenue (ou détail d'erreur dévoilé) sur une question. */
export interface HelpEventDto {
  id: string;
  kind: EventKind;
  contentMd: string;
  courseRefs?: CourseRef[];
  solutionSource?: SolutionSource;
  attemptId?: string | null;
  createdAt: number;
}

/** Contenu d'une réponse, commun au lecteur et au bilan. */
export interface AnswerContent {
  type: AnswerType;
  text: string | null;
  code: string | null;
  codeLang: string | null;
  /** URL de la photo de copie (type `image`). */
  imageUrl: string | null;
}

/** Réponse envoyée et son verdict. */
export interface AttemptDto extends AnswerContent {
  id: string;
  verdict: Verdict;
  /** Détails d'erreur déjà dévoilés (absents tant qu'ils ne sont pas débloqués). */
  revealed: { location?: string; explanation?: string };
  createdAt: number;
}

/** Question affichée dans le lecteur. */
export interface CurrentQuestionState {
  question: QuestionView;
  status: QuestionStatus;
  /** Question fermée : on affiche la solution de transition avant de continuer. */
  closed: boolean;
  events: HelpEventDto[];
  attempts: AttemptDto[];
  locks: LocksDto;
}

/** Une case de la barre de progression. */
export interface OutlineItem {
  id: string;
  label: string;
  exerciseTitle: string;
  status: QuestionStatus;
  /** Une réponse a été enregistrée (utile en mode examen, où le statut reste `seen`). */
  answered: boolean;
}

/** État complet du lecteur de séance. */
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
    /** Durée limite (EI) en secondes. */
    timeLimitSec: number | null;
    elapsedSec: number;
    score: number | null;
    reportId: string | null;
  };
  outline: OutlineItem[];
  currentQuestionId: string | null;
  /** Question affichée (null une fois la séance terminée). */
  current: CurrentQuestionState | null;
}

/** Réponse au signal de présence envoyé toutes les 5 s par le lecteur. */
export interface HeartbeatResponse {
  locks: LocksDto | null;
  elapsedSec: number;
  timeUp: boolean;
  status: SessionStatus;
}

/** Réponse à envoyer. */
export interface SubmitAttemptBody {
  questionId: string;
  type: AnswerType;
  text?: string;
  code?: string;
  codeLang?: string;
  /** Image en data URL (jpeg/png). */
  imageDataUrl?: string;
}

/** Réponse enregistrée (et corrigée), avec les verrous à jour. */
export interface SubmitAttemptResponse {
  attempt: AttemptDto;
  locks: LocksDto;
  status: QuestionStatus;
}
