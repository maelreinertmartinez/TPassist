// Outils de texte communs.

/** Retire les accents (« Théorème » → « Theoreme ») pour comparer ou rechercher des libellés. */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
