import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

let sqlite: Database.Database;
export let db: Db;

export function newId(): string {
  return randomUUID();
}

export function openDb(file = config.dbFile): Db {
  sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: config.migrationsDir });
  // Index plein texte des sections de cours (non géré par drizzle-kit).
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS section_fts USING fts5(
      section_id UNINDEXED,
      course_id UNINDEXED,
      title,
      content,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
  return db;
}

export function rawDb(): Database.Database {
  return sqlite;
}

export function closeDb() {
  sqlite?.close();
}

// ---------- Index plein texte ----------

export function ftsUpsertSection(s: { id: string; courseId: string; title: string; summary: string; contentMd: string; keyConcepts: string[] }) {
  sqlite.prepare('DELETE FROM section_fts WHERE section_id = ?').run(s.id);
  sqlite
    .prepare('INSERT INTO section_fts (section_id, course_id, title, content) VALUES (?, ?, ?, ?)')
    .run(s.id, s.courseId, s.title, [s.summary, s.keyConcepts.join(', '), s.contentMd].join('\n\n'));
}

export function ftsDeleteSections(sectionIds: string[]) {
  const stmt = sqlite.prepare('DELETE FROM section_fts WHERE section_id = ?');
  for (const id of sectionIds) stmt.run(id);
}

export function ftsSearch(courseId: string, query: string, limit = 8): { sectionId: string; title: string; snippet: string }[] {
  const terms = query
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
    .slice(0, 12);
  if (terms.length === 0) return [];
  const match = terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
  const rows = sqlite
    .prepare(
      `SELECT section_id AS sectionId, title, snippet(section_fts, 3, '«', '»', '…', 24) AS snippet
       FROM section_fts WHERE section_fts MATCH ? AND course_id = ? ORDER BY rank LIMIT ?`,
    )
    .all(match, courseId, limit) as { sectionId: string; title: string; snippet: string }[];
  return rows;
}
