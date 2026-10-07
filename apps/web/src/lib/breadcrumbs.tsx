// Fil d'Ariane : chaque page déclare le sien, la barre du haut l'affiche.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** Élément du fil d'Ariane ; sans `to`, c'est la page courante. */
export interface Crumb {
  label: string;
  to?: string;
}

const Ctx = createContext<{ crumbs: Crumb[]; set: (c: Crumb[]) => void }>({ crumbs: [], set: () => {} });

/** Fournit le fil d'Ariane à l'application. */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, set] = useState<Crumb[]>([]);
  return <Ctx.Provider value={{ crumbs, set }}>{children}</Ctx.Provider>;
}

/** Fil d'Ariane de la page affichée. */
export function useCrumbs() {
  return useContext(Ctx).crumbs;
}

/** Déclare le fil d'Ariane de la page courante (après « TPassist »). */
export function useBreadcrumbs(crumbs: Crumb[]) {
  const { set } = useContext(Ctx);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(crumbs);
    return () => set([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
