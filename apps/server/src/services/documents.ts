// Documents PDF d'un cours : ajout (puis analyse en tâche de fond), réanalyse et suppression.
import { eq, inArray } from 'drizzle-orm';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DocumentDto } from '@tpassist/shared';
import { config } from '../config';
import { db, newId } from '../db/client';
import { countWhere, deleteUnits, findById } from '../db/repo';
import { courses, documents, sessions, units } from '../db/schema';
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

/** Relance l'analyse d'un document : ses parties seront recréées. */
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
  deleteUnits(unitIdsOf(id));
  db.delete(documents).where(eq(documents.id, id)).run();
  await removeDocumentFiles(doc);
}

/** Nombre de séances qui seraient supprimées avec le document (pour prévenir l'utilisateur). */
export function documentSessionsCount(id: string): number {
  const unitIds = unitIdsOf(id);
  return unitIds.length ? countWhere(sessions, inArray(sessions.unitId, unitIds)) : 0;
}

function unitIdsOf(documentId: string): string[] {
  return db.select({ id: units.id }).from(units).where(eq(units.documentId, documentId)).all().map((u) => u.id);
}
