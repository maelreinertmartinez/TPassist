// Cours, documents PDF, unités (chapitres, TD, TP, EI, corrigés) et sections de cours.
import type { JobDto } from './jobs';
import type { QuizSummary } from './quiz';
import type { SessionSummary } from './sessions';
import type { WeakPointDto } from './weakPoints';

/** Nature d'une partie détectée dans un PDF. */
export type UnitKind = 'cours' | 'td' | 'tp' | 'ei' | 'corrige';
/** Parties qui contiennent des questions et peuvent être lancées en séance. */
export type PlayableKind = 'td' | 'tp' | 'ei';
/** Partie extraite d'un PDF ou rédigée par l'IA (EI blanche). */
export type UnitOrigin = 'imported' | 'generated';
/** Avancement de l’analyse d’un PDF. */
export type DocumentStatus = 'pending' | 'processing' | 'ready' | 'error';

/** Types de parties jouables (TD, TP, EI). */
export const PLAYABLE_KINDS: readonly PlayableKind[] = ['td', 'tp', 'ei'];

/** Vrai si la partie contient des exercices jouables (TD, TP, EI). */
export function isPlayableKind(kind: UnitKind): kind is PlayableKind {
  return (PLAYABLE_KINDS as readonly string[]).includes(kind);
}

/** Libellé de chaque type de partie. */
export const UNIT_KIND_LABELS: Record<UnitKind, string> = {
  cours: 'Cours',
  td: 'TD',
  tp: 'TP',
  ei: 'EI',
  corrige: 'Corrigé',
};

/** Couleurs proposées pour un cours (accent de la tuile et icône) ; sans choix, la n-ième création prend la n-ième. */
export const COURSE_COLORS = [
  'hsl(213 78% 44%)', // bleu
  'hsl(186 72% 34%)', // cyan
  'hsl(150 52% 32%)', // vert
  'hsl(34 84% 39%)', // ambre
  'hsl(4 66% 45%)', // rouge
  'hsl(262 52% 50%)', // violet
  'hsl(330 60% 45%)', // rose
  'hsl(43 5% 36%)', // gris
] as const;

/** Tuile du tableau de bord. */
export interface CourseSummary {
  id: string;
  name: string;
  color: string;
  /** Clé d'icône (jeu d'icônes défini côté front). */
  icon: string;
  createdAt: number;
  counts: { cours: number; td: number; tp: number; ei: number };
  inProgressSessions: number;
  activeWeakPoints: number;
}

/** PDF importé dans un cours. */
export interface DocumentDto {
  id: string;
  filename: string;
  /** null tant que le PDF n'a pas été lu. */
  pageCount: number | null;
  status: DocumentStatus;
  error: string | null;
  createdAt: number;
}

/** Correction extraite d'un corrigé, avec la question à laquelle elle a été rattachée. */
export interface CorrigeSolution {
  exerciseLabel: string;
  questionLabel: string;
  solutionMd: string;
  pageStart: number | null;
  pageEnd: number | null;
  matchedQuestionId?: string | null;
}

/** Données propres à certains types d'unités (stockées en JSON). */
export interface UnitMeta {
  /** EI : durée de l'épreuve. */
  durationMinutes?: number | null;
  /** Corrigé : solutions extraites, avec leur rattachement éventuel. */
  solutions?: CorrigeSolution[];
  /** Corrigé : titre du sujet corrigé, tel qu'écrit dans le document. */
  targetTitle?: string | null;
  /** EI générée : options de génération. */
  generation?: { difficulty: string; sectionIds: string[]; basedOn: string[] };
}

/** Partie d’un cours (chapitre, TD, TP, EI, corrigé). */
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
  origin: UnitOrigin;
  /** Corrigé : unité corrigée (null si pas encore rattaché). */
  correctsUnitId: string | null;
  /** Un corrigé (rattaché ou intégré au sujet) existe pour cette unité. */
  hasCorrection: boolean;
  questionCount: number;
  sectionCount: number;
  meta: UnitMeta;
}

/** Section d’un chapitre de cours (sans son contenu). */
export interface SectionDto {
  id: string;
  unitId: string;
  title: string;
  pageStart: number | null;
  pageEnd: number | null;
  summary: string;
  keyConcepts: string[];
}

/** Page d'un cours : tout ce qu'affichent ses onglets. */
export interface CourseDetail {
  course: { id: string; name: string; color: string; icon: string; createdAt: number };
  documents: DocumentDto[];
  units: UnitDto[];
  sections: SectionDto[];
  /** Tâches récentes ou en cours (analyse des PDF, générations…). */
  jobs: JobDto[];
  /** Séances, de la plus récente à la plus ancienne. */
  sessions: SessionSummary[];
  quizzes: QuizSummary[];
  weakPoints: WeakPointDto[];
  /** Nombre de notions de la carte du cours (0 tant qu'elle n'a pas été générée). */
  notionCount: number;
}
