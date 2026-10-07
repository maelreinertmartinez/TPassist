// Petits hooks d'interface partagés.
import { useEffect, useRef } from 'react';

/** Appelle `onEscape` à chaque appui sur Échap tant que `enabled` est vrai (la dernière version de la fonction est utilisée). */
export function useEscape(onEscape: () => void, enabled = true) {
  const handler = useRef(onEscape);
  handler.current = onEscape;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handler.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
