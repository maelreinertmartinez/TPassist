// Plein écran d'une zone de page. La zone couvre la fenêtre (via une classe choisie par l'appelant) et on demande au
// navigateur le plein écran de la page entière, pour que tiroirs et fenêtres restent visibles par-dessus.
// Si le navigateur refuse, la zone couvre quand même la fenêtre.
import { useCallback, useEffect, useState } from 'react';

const leaveBrowserFullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
};

/**
 * État du plein écran et de quoi y entrer ou en sortir. Pendant le plein écran, la page ne défile plus ;
 * on en sort quand l'utilisateur quitte le plein écran du navigateur (Échap) et quand le composant disparaît.
 */
export function useFullscreen() {
  const [active, setActive] = useState(false);
  const enter = useCallback(() => {
    setActive(true);
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);
  const exit = useCallback(() => {
    setActive(false);
    leaveBrowserFullscreen();
  }, []);

  useEffect(() => {
    if (!active) return;
    const onChange = () => {
      if (!document.fullscreenElement) setActive(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, [active]);
  useEffect(() => leaveBrowserFullscreen, []);

  return { active, enter, exit };
}
