// Images envoyées par l'étudiant (photos de copie, images jointes au chat) : stockage et lecture.
import { readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { ContentBlock, ImageMediaType } from '../ai/agent';
import { config } from '../config';
import { HttpError } from '../errors';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Type MIME d'une image enregistrée (seuls PNG et JPEG sont stockés). */
export function imageMediaType(path: string): ImageMediaType {
  return path.endsWith('.png') ? 'image/png' : 'image/jpeg';
}

/**
 * Enregistre une image reçue en data URL dans le dossier des photos.
 * @param name nom de fichier sans extension (id de la tentative ou du message)
 * @returns le chemin du fichier créé
 * @throws HttpError 400 si l'image n'est ni PNG ni JPEG, 413 si elle dépasse 12 Mo
 */
export async function saveImage(dataUrl: string, name: string): Promise<string> {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new HttpError(400, 'Image invalide (PNG ou JPEG attendu).');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image trop lourde (12 Mo max).');
  const path = join(config.answersDir, `${name}.${m[1] === 'png' ? 'png' : 'jpg'}`);
  await writeFile(path, buf);
  return path;
}

/** Bloc image à envoyer à l'IA. */
export async function imageBlock(path: string): Promise<ContentBlock> {
  return { type: 'image', mediaType: imageMediaType(path), data: (await readFile(path)).toString('base64') };
}

/** Supprime des photos ; par prudence, seulement celles du dossier des photos. */
export async function removeImages(paths: string[]) {
  for (const p of paths) {
    const inside = relative(config.answersDir, p);
    if (inside && !inside.startsWith('..') && !isAbsolute(inside)) await rm(p, { force: true });
  }
}
