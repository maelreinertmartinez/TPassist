// Points bloquants : notions sur lesquelles l'étudiant a eu du mal, suivies par cours.

/** `mastered` : réussi deux fois de suite ; `resolved` : écarté à la main. */
export type WeakPointStatus = 'active' | 'mastered' | 'resolved';

/** Point bloquant tel que l’affiche le front. */
export interface WeakPointDto {
  id: string;
  notion: string;
  descriptionMd: string;
  /** Priorité entre 0 et 100 : plus elle est haute, plus la notion revient dans les quiz et EI. */
  priority: number;
  status: WeakPointStatus;
  successStreak: number;
  sections: { id: string; title: string }[];
  sourceQuestions: { id: string; label: string; unitTitle: string }[];
  updatedAt: number;
}
