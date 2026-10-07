// Erreurs métier portant un statut HTTP : les services les lèvent, le gestionnaire d'erreurs de Fastify
// (src/index.ts) les traduit en réponse { error, code }. Aucun service ne dépend ainsi de Fastify.

export class HttpError extends Error {
  /**
   * @param status statut HTTP renvoyé au client (400, 404, 409, 423…)
   * @param code identifiant stable pour que le front réagisse à un cas précis (ex. `struggle_required`)
   */
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Lève une erreur 404 « <what> introuvable ». */
export function notFound(what = 'Ressource'): never {
  throw new HttpError(404, `${what} introuvable`);
}
