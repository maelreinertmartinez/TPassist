// Carte des notions d'un cours (carte mentale générée sur demande) et fiches détaillées.
import type { JobDto } from './jobs';

/** Nature d’une notion. */
export type NotionKind = 'concept' | 'definition' | 'theoreme' | 'propriete' | 'methode' | 'formule';

/** Libellé de chaque nature de notion. */
export const NOTION_KIND_LABELS: Record<NotionKind, string> = {
  concept: 'Notion',
  definition: 'Définition',
  theoreme: 'Théorème',
  propriete: 'Propriété',
  methode: 'Méthode',
  formule: 'Formule',
};

/** Notion de la carte. */
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
  /** Notions à comprendre avant celle-ci (du même chapitre ou d'un chapitre précédent). */
  prerequisiteIds: string[];
  /** Points bloquants actifs liés à cette notion. */
  weakPointIds: string[];
}

/** Carte des notions d’un cours. */
export interface NotionMapDto {
  notions: NotionDto[];
  /** Dernière génération demandée (en cours, terminée ou en échec). */
  job: JobDto | null;
  /** Les chapitres ont changé depuis la génération de la carte. */
  stale: boolean;
  generatedAt: number | null;
}

/** Fiche d’une notion et extraits du cours. */
export interface NotionDetailDto {
  id: string;
  /** Fiche rédigée par l'IA (null tant qu'elle n'a pas été demandée). */
  detailMd: string | null;
  /** Sections du cours où la notion est présentée. */
  sections: { id: string; title: string; unitTitle: string; pageStart: number | null; pageEnd: number | null; contentMd: string }[];
}
