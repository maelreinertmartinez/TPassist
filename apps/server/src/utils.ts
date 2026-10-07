// Petits utilitaires génériques, sans dépendance au reste de l'application.

/** Découpe un tableau en lots de `size` éléments. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Entiers de `start` à `end` inclus. */
export function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

/** Regroupe les éléments par clé, en gardant l'ordre d'apparition. */
export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  return out;
}

/** Message lisible d'une erreur quelconque. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const inflight = new Map<string, Promise<unknown>>();

/**
 * Une seule exécution à la fois par clé : les appels simultanés partagent le même résultat.
 * Évite de lancer deux fois la même génération IA quand deux requêtes arrivent ensemble.
 */
export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cur = inflight.get(key) as Promise<T> | undefined;
  if (cur) return cur;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
