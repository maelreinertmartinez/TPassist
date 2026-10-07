// Éditeur de structure : correction à la main de ce que l'IA a extrait d'un PDF.
import type { SectionDto, UnitDto, UnitKind } from './courses';

/** Question telle que la modifie l’éditeur. */
export interface EditorQuestion {
  id: string;
  order: number;
  label: string;
  statementMd: string;
  /** Pages du PDF montrées comme figures. */
  figurePages: number[];
  points: number | null;
  officialSolutionMd: string | null;
}

/** Exercice et ses questions. */
export interface EditorExercise {
  id: string;
  order: number;
  title: string;
  contextMd: string;
  questions: EditorQuestion[];
}

/** Section de cours avec son contenu complet. */
export interface EditorSection extends SectionDto {
  contentMd: string;
}

/** Partie complète pour l’éditeur. */
export interface EditorUnit {
  unit: UnitDto;
  courseName: string;
  exercises: EditorExercise[];
  sections: EditorSection[];
  /** Unités du même cours (pour fusion / rattachement de corrigé). */
  siblings: { id: string; kind: UnitKind; title: string; documentId: string | null }[];
}
