// Documents PDF d'un cours : ajout (puis analyse en tâche de fond), réanalyse, ajout manuel d'une partie à partir
// de pages choisies, et suppression.
import { eq, inArray } from 'drizzle-orm';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UNIT_KINDS, type AddUnitFromPagesBody, type DocumentDto } from '@tpassist/shared';
import { config } from '../config';
import { db, newId } from '../db/client';
import { countWhere, deleteUnits, documentUnitIds, findById } from '../db/repo';
import { courses, documents, sessions } from '../db/schema';
import { HttpError } from '../errors';
import { enqueueJob, jobDto } from '../jobs/queue';

type DocumentRow = typeof documents.$inferSelect;

/** Document pour le front. */
function documentDto(d: DocumentRow): DocumentDto {
  return { id: d.id, filename: d.filename, pageCount: d.pageCount, status: d.status, error: d.error, createdAt: d.createdAt };
}

/** Documents d'un cours, du plus ancien au plus récent. */
export function listDocuments(courseId: string): DocumentDto[] {
  return db.select().from(documents).where(eq(documents.courseId, courseId)).orderBy(documents.createdAt).all().map(documentDto);
}

/**
 * Enregistre un PDF et lance son analyse par l'IA.
 * @throws HttpError 404 si le cours n'existe pas, 400 si le fichier n'est pas un PDF
 */
export async function addDocument(courseId: string, filename: string, data: Buffer) {
  findById(courses, courseId, 'Cours');
  if (data.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(400, `« ${filename} » n'est pas un PDF valide.`);
  const id = newId();
  const dir = join(config.filesDir, courseId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.pdf`);
  await writeFile(path, data);
  const doc = db.insert(documents).values({ id, courseId, filename, path, status: 'pending' }).returning().get();
  const job = enqueueJob({ type: 'ingest', courseId, refId: id });
  return { document: documentDto(doc), job: jobDto(job) };
}

/**
 * Lance l'extraction d'une partie à partir d'une plage de pages d'un document déjà analysé.
 * @throws HttpError 404 si le document n'existe pas, 409 s'il n'est pas encore analysé, 400 si la demande est invalide
 */
export function addUnitFromPages(documentId: string, body: Partial<AddUnitFromPagesBody>) {
  const doc = findById(documents, documentId, 'Document');
  if (doc.status !== 'ready' || !doc.pageCount) throw new HttpError(409, 'Attends la fin de l’analyse du document.');
  const { kind, pageStart, pageEnd } = body;
  if (!kind || !UNIT_KINDS.includes(kind)) throw new HttpError(400, 'Type de partie inconnu.');
  const title = body.title?.trim();
  if (!title) throw new HttpError(400, 'Le titre est obligatoire.');
  const isPage = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= doc.pageCount!;
  if (!isPage(pageStart) || !isPage(pageEnd) || pageStart > pageEnd) {
    throw new HttpError(400, `Pages invalides : choisis une plage entre 1 et ${doc.pageCount}.`);
  }
  const payload: AddUnitFromPagesBody = { kind, title, pageStart, pageEnd };
  return jobDto(enqueueJob({ type: 'extract_unit', courseId: doc.courseId, refId: documentId, payload: { ...payload } }));
}

/** Relance l'analyse d'un document : les parties détectées seront recréées (celles ajoutées à la main sont gardées). */
export function reanalyzeDocument(id: string) {
  const doc = findById(documents, id, 'Document');
  db.update(documents).set({ status: 'pending', error: null }).where(eq(documents.id, id)).run();
  return jobDto(enqueueJob({ type: 'ingest', courseId: doc.courseId, refId: id }));
}

/** Supprime le PDF et les pages rendues d'un document (pas les lignes en base). */
export async function removeDocumentFiles(doc: Pick<DocumentRow, 'id' | 'path'>) {
  await rm(doc.path, { force: true });
  await rm(join(config.pagesDir, doc.id), { recursive: true, force: true });
}

/** Supprime un document, ses parties (et leurs séances) et ses fichiers. */
export async function deleteDocument(id: string) {
  const doc = findById(documents, id, 'Document');
  deleteUnits(documentUnitIds(id));
  db.delete(documents).where(eq(documents.id, id)).run();
  await removeDocumentFiles(doc);
}

/**
 * Séances qui seraient supprimées (pour prévenir l'utilisateur) : `count` avec le document,
 * `reanalyzeCount` par une réanalyse (qui garde les parties ajoutées à la main).
 */
export function documentSessionsCount(id: string): { count: number; reanalyzeCount: number } {
  const sessionsOf = (unitIds: string[]) => (unitIds.length ? countWhere(sessions, inArray(sessions.unitId, unitIds)) : 0);
  return { count: sessionsOf(documentUnitIds(id)), reanalyzeCount: sessionsOf(documentUnitIds(id, { keepManual: true })) };
}
