// Tâches de fond (file persistée en base).

export type JobType = 'ingest' | 'link_corrections' | 'report' | 'quiz' | 'generate_ei' | 'notions';
/** Avancement d’une tâche. */
export type JobStatus = 'queued' | 'running' | 'done' | 'error';

/** Tâche de fond telle que l’affiche le front. */
export interface JobDto {
  id: string;
  type: JobType;
  status: JobStatus;
  /** Avancement entre 0 et 1. */
  progress: number;
  /** Étape en cours, affichable telle quelle. */
  message: string | null;
  error: string | null;
  /** Objet traité (document, séance, quiz, cours…), selon le type. */
  refId: string | null;
  createdAt: number;
  updatedAt: number;
}
