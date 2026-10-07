// Bilan de fin de séance : chaque question, les réponses, les explications et les points bloquants.
import type { UnitKind } from './courses';
import type { AnswerContent, QuestionStatus, SessionMode, SolutionSource, Verdict } from './sessions';

/** Avancement de la rédaction d’un bilan. */
export type ReportStatus = 'pending' | 'ready' | 'error';

/** Réponse rappelée dans le bilan, avec l’erreur commise. */
export interface ReportAttempt extends AnswerContent {
  verdict: Verdict;
  errorLocation: string | null;
  errorExplanation: string | null;
}

/** Bilan d’une question. */
export interface ReportQuestion {
  questionId: string;
  label: string;
  exerciseTitle: string;
  contextMd: string;
  statementMd: string;
  status: QuestionStatus;
  attempts: ReportAttempt[];
  /** Libellés des aides utilisées (« Indice », « 2 réponse(s) fausse(s) »…). */
  helps: string[];
  activeMs: number;
  explanationMd: string;
  solutionMd: string;
  solutionSource: SolutionSource;
  /** Points obtenus et barème (EI uniquement). */
  score: number | null;
  maxScore: number | null;
}

/** Bilan complet d’une séance. */
export interface ReportDto {
  id: string;
  sessionId: string;
  status: ReportStatus;
  error: string | null;
  courseId: string;
  courseName: string;
  unitTitle: string;
  unitKind: UnitKind;
  mode: SessionMode;
  /** Note sur 20 (EI uniquement). */
  score: number | null;
  createdAt: number;
  strengthsMd: string;
  overallMd: string;
  blockingPoints: { weakPointId: string | null; notion: string; descriptionMd: string }[];
  questions: ReportQuestion[];
  /** Quiz de révision facultatif proposé à la fin du bilan. */
  reviewQuiz: { proposedSize: number; noStruggle: boolean; quizId: string | null };
}
