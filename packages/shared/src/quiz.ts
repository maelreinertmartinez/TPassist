// Quiz : quiz de révision d'une séance ou quiz complet sur le cours.

export type QuizKind = 'tp_review' | 'course_full';
/** `mcq` : QCM ; `open` : réponse courte corrigée par l’IA. */
export type QuizItemType = 'mcq' | 'open';
/** Avancement d’un quiz (génération, prêt, terminé, erreur). */
export type QuizStatus = 'generating' | 'ready' | 'done' | 'error';

/** Quiz dans l'historique du cours. */
export interface QuizSummary {
  id: string;
  kind: QuizKind;
  title: string;
  status: QuizStatus;
  score: number | null;
  total: number;
  createdAt: number;
}

/** Question de quiz. */
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
  /** Correction de l'IA pour une question ouverte. */
  feedbackMd: string | null;
  /** Point bloquant travaillé par la question, s'il y en a un. */
  weakPointNotion: string | null;
}

/** Quiz complet. */
export interface QuizDto {
  id: string;
  courseId: string;
  courseName: string;
  kind: QuizKind;
  title: string;
  status: QuizStatus;
  error: string | null;
  score: number | null;
  total: number;
  items: QuizItemDto[];
  createdAt: number;
}
