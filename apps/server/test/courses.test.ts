import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // Dossier de données jetable : la suppression efface de vrais fichiers.
  process.env.DATA_DIR = `${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/tpassist-courses-test-${process.pid}`;
});

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, ensureDataDirs } from '../src/config';
import { db, newId, openDb } from '../src/db/client';
import { insertExercises } from '../src/db/repo';
import { attempts, chatMessages, chatThreads, courses, jobs, sessions, units } from '../src/db/schema';
import { deleteCourse } from '../src/services/courses';
import { createSession } from '../src/services/sessions';

beforeAll(() => ensureDataDirs());
afterAll(() => rmSync(config.dataDir, { recursive: true, force: true }));
beforeEach(() => {
  openDb(':memory:');
});

describe('suppression d’un cours', () => {
  it('efface ses données, ses tâches en attente et ses photos, sans toucher aux autres cours', async () => {
    const courseId = newId();
    const other = newId();
    db.insert(courses).values([{ id: courseId, name: 'À supprimer' }, { id: other, name: 'Autre' }]).run();
    const unitId = newId();
    db.insert(units).values({ id: unitId, courseId, kind: 'td', title: 'TD 1' }).run();
    const [ex] = insertExercises(unitId, null, [
      { title: 'Ex', contextMd: '', questions: [{ label: '1', statementMd: 'Q', figurePages: [], dependsOnPrevious: false, points: null }] },
    ]);
    const sessionId = createSession(unitId, 'tp').id;

    const photo = join(config.answersDir, `photo-${courseId}.png`);
    const chatPhoto = join(config.answersDir, `chat-${courseId}.jpg`);
    const outside = join(config.dataDir, `ailleurs-${courseId}.png`);
    for (const f of [photo, chatPhoto, outside]) writeFileSync(f, 'x');
    db.insert(attempts)
      .values({ id: newId(), sessionId, questionId: ex.questionIds[0], type: 'image', imagePath: photo, verdict: 'incorrect', submittedAtMs: 0 })
      .run();
    const threadId = newId();
    db.insert(chatThreads).values({ id: threadId, scope: 'course', courseId }).run();
    db.insert(chatMessages)
      .values([
        { id: newId(), threadId, role: 'user', contentMd: 'q', imagePath: chatPhoto },
        { id: newId(), threadId, role: 'user', contentMd: 'q2', imagePath: outside },
      ])
      .run();
    db.insert(jobs).values({ id: newId(), type: 'quiz', courseId, status: 'queued' }).run();

    await deleteCourse(courseId);

    expect(db.select().from(courses).all().map((c) => c.id)).toEqual([other]);
    expect(db.select().from(units).all()).toHaveLength(0);
    expect(db.select().from(sessions).all()).toHaveLength(0);
    expect(db.select().from(chatMessages).all()).toHaveLength(0);
    expect(db.select().from(jobs).all()).toHaveLength(0);
    expect(existsSync(photo)).toBe(false);
    expect(existsSync(chatPhoto)).toBe(false);
    // Un chemin hors du dossier des photos n'est jamais supprimé.
    expect(existsSync(outside)).toBe(true);
  });

  it('refuse un cours inexistant', async () => {
    await expect(deleteCourse('inconnu')).rejects.toThrow(/introuvable/i);
  });
});
